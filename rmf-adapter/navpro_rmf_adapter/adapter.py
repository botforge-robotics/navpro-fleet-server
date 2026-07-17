"""NavPro EasyFullControl fleet adapter with registry-driven dynamic add.

Pattern sources (verified against installed versions in the rmf-core image):
  - rmf_demos fleet_adapter.py (EasyFullControl update-loop pattern)
  - free_fleet (jazzy @ cc5b8cd8) fleet_adapter.py + Nav2RobotAdapter

Differences from stock free_fleet_adapter:
  - Robots are NOT only taken from the fleet config YAML at startup. A poll
    loop queries the Platform API registry (default every 5 s) and, for every
    newly-active robot, reloads the platform-generated fleet config YAML and
    constructs a free_fleet Nav2RobotAdapter for it. Nav2RobotAdapter's
    constructor performs the EasyFullControl fleet_handle.add_robot() call.
  - Optionally posts robot state snapshots back to the Platform API.

Graceful-reload limitation (documented in README.md): robots can only be
ADDED at runtime. Removing a robot or editing fleet-level configuration
(traits, battery system, transforms) requires a container bounce, which the
platform orchestrates.
"""

from __future__ import annotations

import logging
import queue
import threading
import time

import nudged
import rclpy
import rclpy.node
from rclpy.duration import Duration
from rclpy.parameter import Parameter
import rmf_adapter
from rmf_adapter import Adapter, Transformation
import rmf_adapter.easy_full_control as rmf_easy
import rmf_adapter.fleet_update_handle as rmf_fleet
from tf2_ros import Buffer
import yaml
import zenoh

from free_fleet_adapter.nav2_robot_adapter import Nav2RobotAdapter

from navpro_rmf_adapter.config import AdapterConfig
from navpro_rmf_adapter.registry_client import RegistryClient

_LOGGER = logging.getLogger(__name__)


def compute_transforms(level, coords, node=None) -> Transformation:
    """Get transforms between RMF and robot coordinates (free_fleet pattern)."""
    rmf_coords = coords['rmf']
    robot_coords = coords['robot']
    tf = nudged.estimate(rmf_coords, robot_coords)
    if node:
        mse = nudged.estimate_error(tf, rmf_coords, robot_coords)
        node.get_logger().info(
            f'Transformation error estimate for {level}: {mse}'
        )
    return Transformation(
        tf.get_rotation(),
        tf.get_scale(),
        tf.get_translation(),
    )


class NavProFleetAdapter:
    """EasyFullControl fleet adapter + Platform API registry poll loop."""

    def __init__(self, cfg: AdapterConfig):
        self.cfg = cfg
        self.registry = RegistryClient(
            cfg.platform_api_url,
            service_token=cfg.service_token,
            provisioning_token=cfg.provisioning_token,
        )

        # robot name -> Nav2RobotAdapter, guarded by _robots_lock (mutated by
        # the main thread, read by update/poll threads).
        self.robots: dict[str, Nav2RobotAdapter] = {}
        self._robots_lock = threading.Lock()
        # Names pending Nav2RobotAdapter construction on the main thread.
        self._pending_add: queue.Queue[str] = queue.Queue()
        # Names already added or currently queued (main+poll thread bookkeeping).
        self._known_names: set[str] = set()
        # Robot name -> registry id, for state posts.
        self._registry_ids: dict[str, str] = {}
        self._missing_config_warned: set[str] = set()

        self.node: rclpy.node.Node | None = None
        self.adapter: Adapter | None = None
        self.fleet_handle = None
        self.fleet_config: rmf_easy.FleetConfiguration | None = None
        self.config_yaml: dict | None = None
        self.zenoh_session: zenoh.Session | None = None
        self.tf_buffer = Buffer()

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------
    def start(self):
        cfg = self.cfg
        rmf_adapter.init_rclcpp()

        self.fleet_config = rmf_easy.FleetConfiguration.from_config_files(
            cfg.fleet_config_path, cfg.nav_graph_path
        )
        assert self.fleet_config, (
            f'Failed to parse fleet config [{cfg.fleet_config_path}]'
        )

        with open(cfg.fleet_config_path, 'r') as f:
            self.config_yaml = yaml.safe_load(f)

        fleet_name = self.fleet_config.fleet_name
        if fleet_name != cfg.fleet_name:
            _LOGGER.warning(
                'Fleet name mismatch: config says %r, env says %r; '
                'using config value.', fleet_name, cfg.fleet_name
            )

        self.node = rclpy.node.Node(f'{fleet_name}_command_handle')
        self.adapter = Adapter.make(f'{fleet_name}_fleet_adapter')
        assert self.adapter, (
            'Unable to initialize fleet adapter. '
            'Please ensure the RMF Schedule Node is running.'
        )

        if cfg.use_sim_time:
            self.node.set_parameters(
                [Parameter('use_sim_time', Parameter.Type.BOOL, True)]
            )
            self.adapter.node.use_sim_time()

        self.adapter.start()
        time.sleep(1.0)

        self.fleet_config.server_uri = cfg.server_uri

        for level, coords in self.config_yaml.get(
            'reference_coordinates', {}
        ).items():
            tf = compute_transforms(level, coords, self.node)
            self.fleet_config.add_robot_coordinates_transformation(level, tf)

        self.fleet_handle = self.adapter.add_easy_fleet(self.fleet_config)
        assert self.fleet_handle is not None, (
            'Failed to create EasyFullControl fleet; verify the fleet config.'
        )

        self._register_plugin_actions()

        zenoh_config = (
            zenoh.Config.from_file(cfg.zenoh_config_path)
            if cfg.zenoh_config_path is not None
            else zenoh.Config()
        )
        self.zenoh_session = zenoh.open(zenoh_config)

    def _register_plugin_actions(self):
        """Accept performable actions declared under `plugins:` in the fleet
        config (free_fleet pattern); execution is handled per-robot by
        Nav2RobotAdapter's plugin loading."""
        plugin_config = self.config_yaml.get('plugins')
        if plugin_config is None:
            return

        def _accept_action(_description: dict):
            confirm = rmf_fleet.Confirmation()
            confirm.accept()
            return confirm

        for plugin_name, plugin_data in plugin_config.items():
            actions = plugin_data.get('actions')
            if not actions:
                _LOGGER.warning(
                    'No actions provided for plugin [%s]; fleet will not bid '
                    'on tasks using this plugin.', plugin_name
                )
                continue
            for action in actions:
                # TODO(pin-api): fleet_handle.more().add_performable_action
                # follows free_fleet jazzy @ cc5b8cd8 fleet_adapter.py; verify
                # against the installed rmf_fleet_adapter_python on version
                # bumps (https://github.com/open-rmf/free_fleet/blob/jazzy/
                # free_fleet_adapter/free_fleet_adapter/fleet_adapter.py).
                self.fleet_handle.more().add_performable_action(
                    action, _accept_action
                )

    # ------------------------------------------------------------------
    # Dynamic robot add
    # ------------------------------------------------------------------
    def _reload_config_for(self, robot_name: str):
        """Reload the platform-generated fleet config YAML and return
        (RobotConfiguration, robot_config_yaml, full_config_yaml) for
        `robot_name`, or None if the platform has not (yet) written this
        robot into the YAML."""
        cfg = self.cfg
        try:
            with open(cfg.fleet_config_path, 'r') as f:
                config_yaml = yaml.safe_load(f)
            robot_yaml = config_yaml['rmf_fleet']['robots'].get(robot_name)
            if robot_yaml is None:
                return None
            # TODO(pin-api): RobotConfiguration objects are taken from a
            # freshly parsed FleetConfiguration and handed to a fleet handle
            # created from the startup parse. They are plain configuration
            # data so this is expected to be safe, but it must be verified
            # against the installed rmf_fleet_adapter_python (EasyFullControl)
            # during the dynamic-add spike (plan spike 1).
            fresh = rmf_easy.FleetConfiguration.from_config_files(
                cfg.fleet_config_path, cfg.nav_graph_path
            )
            if fresh is None or robot_name not in fresh.known_robots:
                return None
            robot_config = fresh.get_known_robot_configuration(robot_name)
            return robot_config, robot_yaml, config_yaml
        except (OSError, yaml.YAMLError, KeyError) as exc:
            _LOGGER.error('Failed reloading fleet config for %s: %s',
                          robot_name, exc)
            return None

    def _add_robot(self, robot_name: str):
        """Construct a Nav2RobotAdapter for `robot_name`.

        MUST run on the main thread: the constructor internally calls
        rclpy.spin_until_future_complete on our node while waiting for the
        robot's initial pose over zenoh, so no other thread may be spinning
        the node concurrently.
        """
        loaded = self._reload_config_for(robot_name)
        if loaded is None:
            if robot_name not in self._missing_config_warned:
                _LOGGER.warning(
                    'Robot [%s] is active in the registry but absent from '
                    '%s; waiting for the platform to regenerate the fleet '
                    'config.', robot_name, self.cfg.fleet_config_path
                )
                self._missing_config_warned.add(robot_name)
            self._known_names.discard(robot_name)
            return

        robot_config, robot_yaml, config_yaml = loaded
        self._missing_config_warned.discard(robot_name)

        nav_stack = robot_yaml.get('navigation_stack')
        if nav_stack != 2:
            _LOGGER.error(
                'Robot [%s] has navigation_stack=%r; only Nav2 (2) is '
                'supported by the NavPro adapter.', robot_name, nav_stack
            )
            return

        try:
            # TODO(pin-api): constructor signature matches free_fleet jazzy @
            # cc5b8cd8 (name, configuration, robot_config_yaml, plugin_config,
            # node, zenoh_session, fleet_handle, fleet_config, tf_buffer).
            # Re-verify on any free_fleet bump; the humble->jazzy transition
            # already changed this signature once.
            robot = Nav2RobotAdapter(
                robot_name,
                robot_config,
                robot_yaml,
                config_yaml.get('plugins'),
                self.node,
                self.zenoh_session,
                self.fleet_handle,
                self.fleet_config,
                self.tf_buffer,
            )
        except RuntimeError as exc:
            # Typically an init-pose timeout (robot not publishing over
            # zenoh yet). Retry on a later poll tick.
            _LOGGER.warning('Failed to add robot [%s]: %s; will retry.',
                            robot_name, exc)
            self._known_names.discard(robot_name)
            return

        with self._robots_lock:
            self.robots[robot_name] = robot
        _LOGGER.info('Robot [%s] added to fleet [%s].',
                     robot_name, self.fleet_config.fleet_name)

    # ------------------------------------------------------------------
    # Threads
    # ------------------------------------------------------------------
    def _registry_poll_loop(self):
        """Poll the Platform API registry; enqueue newly-active robots."""
        while rclpy.ok():
            try:
                active = self.registry.list_active_robots(
                    self.cfg.fleet_name
                )
                for record in active:
                    self._registry_ids[record.name] = record.id
                    if record.name not in self._known_names:
                        self._known_names.add(record.name)
                        self._pending_add.put(record.name)
                        _LOGGER.info(
                            'Registry reports new active robot [%s]; '
                            'queueing add.', record.name
                        )
                active_names = {r.name for r in active}
                with self._robots_lock:
                    added = set(self.robots.keys())
                for name in added - active_names:
                    # Removal requires a bounce; see README.md.
                    _LOGGER.warning(
                        'Robot [%s] is no longer active in the registry but '
                        'cannot be removed at runtime; the platform should '
                        'bounce rmf-core to apply removals.', name
                    )
            except Exception as exc:  # noqa: BLE001 - keep polling forever
                _LOGGER.warning('Registry poll failed: %s', exc)
            time.sleep(self.cfg.poll_interval_sec)

    def _state_update_loop(self):
        """Push robot states into RMF (free_fleet update-loop pattern)."""
        update_period = 1.0 / float(
            self.config_yaml['rmf_fleet'].get(
                'robot_state_update_frequency', 10.0
            )
        )
        last_state_post = 0.0
        while rclpy.ok():
            now = self.node.get_clock().now()
            with self._robots_lock:
                robots = list(self.robots.items())

            for name, robot in robots:
                try:
                    pose = robot.get_pose()
                    if pose is None:
                        continue
                    state = rmf_easy.RobotState(
                        robot.get_map_name(),
                        pose,
                        robot.get_battery_soc(),
                    )
                    robot.update(state)
                except Exception as exc:  # noqa: BLE001 - isolate per robot
                    _LOGGER.warning('Update failed for robot [%s]: %s',
                                    name, exc)

            if self.cfg.post_state and robots:
                wall_now = time.monotonic()
                if wall_now - last_state_post \
                        >= self.cfg.state_post_interval_sec:
                    last_state_post = wall_now
                    self._post_states(robots)

            next_wakeup = now + Duration(nanoseconds=update_period * 1e9)
            while self.node.get_clock().now() < next_wakeup:
                time.sleep(0.001)

    def _post_states(self, robots):
        """Best-effort robot state snapshots back to the Platform API."""
        for name, robot in robots:
            robot_id = self._registry_ids.get(name)
            if robot_id is None:
                continue
            try:
                pose = robot.get_pose()
                snapshot = {
                    'fleet': self.fleet_config.fleet_name,
                    'map': robot.get_map_name(),
                    'pose': (
                        {'x': pose[0], 'y': pose[1], 'yaw': pose[2]}
                        if pose is not None else None
                    ),
                    'battery_soc': robot.get_battery_soc(),
                    'source': 'rmf-adapter',
                }
                self.registry.post_robot_state(robot_id, snapshot)
            except Exception as exc:  # noqa: BLE001 - snapshots are optional
                _LOGGER.debug('State snapshot for [%s] failed: %s', name, exc)

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------
    def run(self):
        """Spin the command-handle node and construct queued robot adapters.

        The main thread is the ONLY thread that spins self.node. Queued adds
        are constructed between spins because Nav2RobotAdapter.__init__
        spins the node internally while waiting for the initial pose.
        """
        poll_thread = threading.Thread(
            target=self._registry_poll_loop, daemon=True
        )
        update_thread = threading.Thread(
            target=self._state_update_loop, daemon=True
        )
        poll_thread.start()
        update_thread.start()

        try:
            while rclpy.ok():
                try:
                    robot_name = self._pending_add.get_nowait()
                except queue.Empty:
                    robot_name = None
                if robot_name is not None:
                    self._add_robot(robot_name)
                rclpy.spin_once(self.node, timeout_sec=0.1)
        except KeyboardInterrupt:
            pass
        finally:
            self.registry.close()
            if self.zenoh_session is not None:
                self.zenoh_session.close()
            self.node.destroy_node()


def run_adapter(cfg: AdapterConfig):
    rclpy.init()
    app = NavProFleetAdapter(cfg)
    app.start()
    app.run()
    rclpy.shutdown()
