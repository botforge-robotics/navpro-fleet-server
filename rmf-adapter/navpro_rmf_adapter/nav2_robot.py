"""Nav2 robot adapter with TF stamps rewritten to the fleet-server clock.

Robot Pis and the fleet server can disagree by tens–hundreds of ms. free_fleet's
Nav2TfHandler stores zenoh TF with the robot's stamp; map→odom (slow) and
odom→base_link (fast) then fail Time(0) lookups with ExtrapolationException,
pose updates freeze, and the fleet never bids on tasks.

Rewrite every TF stamp to (node.now() - 50ms) before set_transform so the
whole chain shares one server-clock time slightly in the past.

Also: free_fleet's zenoh NavigateToPose *action* CDR does not match
zenoh-bridge-ros2dds (goals are dropped). NavPro publishes PoseStamped on
``fleet_nav_goal``; the on-robot ``nav_goal_relay`` calls Nav2 locally.
"""

from __future__ import annotations

import logging
import math

import rclpy
import zenoh
from builtin_interfaces.msg import Time as TimeMsg
from free_fleet.convert import transform_stamped_to_ros2_msg
from free_fleet.ros2_types import TFMessage
from free_fleet.utils import namespacify
from free_fleet_adapter import nav2_robot_adapter as _ff_nav2
from free_fleet_adapter.nav2_robot_adapter import Nav2RobotAdapter
from free_fleet_adapter.robot_adapter import ExecutionHandle
from geometry_msgs.msg import TransformStamped
import rmf_adapter.easy_full_control as rmf_easy

_LOGGER = logging.getLogger(__name__)

# Stamp slightly in the past so lookups at "now" never need future extrapolation.
_STAMP_LAG_NS = 50_000_000  # 50 ms
# Zenoh action queries must never block the RMF worker thread.
_ZENOH_NAV_TIMEOUT_S = 1.0
# Already-at-goal tolerance (meters) — skip zenoh navigate entirely.
_AT_GOAL_TOL_M = 0.45
# Ignore re-issued goals that are essentially the same XY (stops cancel thrash).
_SAME_GOAL_TOL_M = 0.30


class NavProTfHandler:
    """Zenoh TF → tf2 buffer, stamped with the adapter node clock."""

    def __init__(
        self,
        robot_name,
        zenoh_session,
        tf_buffer,
        node,
        robot_frame='base_link',
        map_frame='map',
    ):
        self.robot_name = robot_name
        self.zenoh_session = zenoh_session
        self.node = node
        self.tf_buffer = tf_buffer
        self.robot_frame = robot_frame
        self.map_frame = map_frame
        self._tf_count = 0

        def _tf_callback(sample: zenoh.Sample):
            try:
                payload = sample.payload
                if payload is None:
                    return
                raw = payload.to_bytes() if hasattr(payload, 'to_bytes') else bytes(payload)
                transform = TFMessage.deserialize(raw)
            except Exception as exc:  # noqa: BLE001
                self.node.get_logger().debug(
                    f'Failed to deserialize TF payload: {type(exc)}: {exc}'
                )
                return

            # One shared server stamp for every transform in this message so
            # map→odom and odom→base_link always have a common time.
            stamp_ns = max(0, self.node.get_clock().now().nanoseconds - _STAMP_LAG_NS)
            stamp = TimeMsg(
                sec=stamp_ns // 1_000_000_000,
                nanosec=stamp_ns % 1_000_000_000,
            )
            for zt in transform.transforms:
                t = transform_stamped_to_ros2_msg(zt)
                t.header.stamp = stamp
                t.header.frame_id = namespacify(
                    zt.header.frame_id, self.robot_name
                )
                t.child_frame_id = namespacify(
                    zt.child_frame_id, self.robot_name
                )
                self.tf_buffer.set_transform(
                    t, f'{self.robot_name}_TfListener'
                )
            self._tf_count += 1

        self.tf_sub = self.zenoh_session.declare_subscriber(
            namespacify('tf', self.robot_name),
            _tf_callback,
        )

    def get_transform(self) -> TransformStamped | None:
        try:
            # Do NOT pass timeout=0 — in tf2 that can mean "wait forever".
            return self.tf_buffer.lookup_transform(
                namespacify(self.map_frame, self.robot_name),
                namespacify(self.robot_frame, self.robot_name),
                rclpy.time.Time(),
            )
        except Exception as err:
            self.node.get_logger().info(
                f'Unable to get transform between {self.robot_frame} '
                f'and {self.map_frame}: {type(err)}: {err}'
            )
        return None


class NavProNav2RobotAdapter(Nav2RobotAdapter):
    """Nav2RobotAdapter that uses NavProTfHandler for the whole lifetime."""

    def __init__(self, *args, **kwargs):
        # Parent constructs Nav2TfHandler before waiting for pose — patch the
        # class so init uses our server-clock handler (no dual subscribers).
        previous = _ff_nav2.Nav2TfHandler
        _ff_nav2.Nav2TfHandler = NavProTfHandler
        try:
            super().__init__(*args, **kwargs)
        finally:
            _ff_nav2.Nav2TfHandler = previous

        # Defensive: ensure instance handler is ours even if parent cached class.
        if not isinstance(self.tf_handler, NavProTfHandler):
            old = self.tf_handler
            try:
                old.tf_sub.undeclare()
            except Exception:  # noqa: BLE001
                pass
            self.tf_handler = NavProTfHandler(
                self.name,
                self.zenoh_session,
                self.tf_buffer,
                self.node,
                robot_frame=self.robot_frame,
                map_frame=self.map_frame,
            )
        _LOGGER.info(
            'Robot [%s] using NavPro TF handler (server-clock stamps).',
            self.name,
        )
        self._subscribe_battery_state()
        self._setup_topic_nav()

    def _setup_topic_nav(self) -> None:
        """Nav2 over zenoh *topics* (PoseStamped), not free_fleet action CDR.

        zenoh-bridge-ros2dds rejects free_fleet NavigateToPose action queries
        as invalid CDR; topic routes match and work for TF/battery already.
        """
        from rclpy.serialization import deserialize_message
        from std_msgs.msg import Int32

        self._nav_status = 0  # GoalStatus.STATUS_UNKNOWN
        self._nav_goal_xy: tuple[float, float] | None = None
        self._nav_seq = 0
        self._abort_replanned = False
        # Ignore CANCELED that we caused ourselves when replacing a goal.
        self._expect_cancel = False

        def _on_status(sample: zenoh.Sample) -> None:
            try:
                payload = sample.payload
                if payload is None:
                    return
                raw = (
                    payload.to_bytes()
                    if hasattr(payload, 'to_bytes')
                    else bytes(payload)
                )
                msg = deserialize_message(raw, Int32)
                status = int(msg.data)
                # Drop stale CANCEL after we already issued the next goal.
                if status in (5,) and self._expect_cancel:
                    return
                self._nav_status = status
            except Exception as exc:  # noqa: BLE001
                self.node.get_logger().debug(
                    f'[{self.name}] fleet_nav_status decode failed: {exc}'
                )

        self._nav_status_sub = self.zenoh_session.declare_subscriber(
            namespacify('fleet_nav_status', self.name),
            _on_status,
        )
        _LOGGER.info(
            'Robot [%s] Nav2 via zenoh topics fleet_nav_goal / fleet_nav_status.',
            self.name,
        )

    def _subscribe_battery_state(self) -> None:
        """free_fleet listens on ``battery_state``; NavPro publishes ``battery/state``."""
        from free_fleet.ros2_types import SensorMsgs_BatteryState

        # Drop the stock subscriber (wrong key on real robots).
        old = getattr(self, 'battery_state_sub', None)
        if old is not None:
            try:
                old.undeclare()
            except Exception:  # noqa: BLE001
                pass

        def _on_battery(sample: zenoh.Sample) -> None:
            try:
                payload = sample.payload
                if payload is None:
                    return
                raw = (
                    payload.to_bytes()
                    if hasattr(payload, 'to_bytes')
                    else bytes(payload)
                )
                battery_state = SensorMsgs_BatteryState.deserialize(raw)
                pct = float(battery_state.percentage)
                # ROS BatteryState.percentage is normally [0,1]; accept 0–100 too.
                if pct > 1.0:
                    pct = pct / 100.0
                if 0.0 <= pct <= 1.0:
                    self.battery_soc = pct
            except Exception as exc:  # noqa: BLE001
                self.node.get_logger().debug(
                    f'[{self.name}] battery/state decode failed: {exc}'
                )

        # Prefer the real topic; also keep legacy key for older bridges.
        self.battery_state_sub = self.zenoh_session.declare_subscriber(
            namespacify('battery/state', self.name),
            _on_battery,
        )
        self._battery_state_legacy_sub = self.zenoh_session.declare_subscriber(
            namespacify('battery_state', self.name),
            _on_battery,
        )
        _LOGGER.info(
            'Robot [%s] battery from zenoh keys battery/state (+ battery_state).',
            self.name,
        )

    def get_battery_soc(self) -> float:
        # free_fleet defaults to 1.0; keep updates best-effort if zenoh battery
        # payloads are empty/timeout.
        try:
            soc = float(self.battery_soc)
            if 0.0 <= soc <= 1.0:
                return soc
            if 1.0 < soc <= 100.0:
                return soc / 100.0
        except Exception:  # noqa: BLE001
            pass
        return 1.0

    def _xy_distance_to(self, x: float, y: float) -> float | None:
        pose = self.get_pose()
        if pose is None:
            return None
        return math.hypot(pose[0] - x, pose[1] - y)

    def navigate(
        self,
        destination: rmf_easy.Destination,
        execution: rmf_easy.CommandExecution,
    ):
        """Publish PoseStamped on fleet_nav_goal (robot relay → Nav2)."""
        from rclpy.serialization import serialize_message
        from geometry_msgs.msg import PoseStamped
        from tf_transformations import quaternion_from_euler

        x, y = destination.position[0], destination.position[1]
        # Prefer bearing-to-goal over RMF lane yaw. Lane/request yaw made
        # RotationShim + DWB RotateToGoal spin in place (and clip walls) when
        # the approach heading differed — same fix as path_to_nav2_bridge.
        yaw = destination.position[2]
        pose_now = self.get_pose()
        if pose_now is not None:
            dx = float(x) - float(pose_now[0])
            dy = float(y) - float(pose_now[1])
            if math.hypot(dx, dy) > 0.05:
                yaw = math.atan2(dy, dx)
        dist = self._xy_distance_to(x, y)
        if dist is not None and dist <= _AT_GOAL_TOL_M:
            self.node.get_logger().info(
                f'[{self.name}] already at goal '
                f'({dist:.2f} m ≤ {_AT_GOAL_TOL_M} m); finishing navigate.'
            )
            execution.finished()
            self.exec_handle = None
            self._nav_goal_xy = None
            return

        if destination.map != self.map_name:
            self.replan_counts += 1
            self.node.get_logger().error(
                f'Destination is on map [{destination.map}], while robot '
                f'[{self.name}] is on map [{self.map_name}], replan count '
                f'[{self.replan_counts}]'
            )
            if self.update_handle is not None:
                self.update_handle.more().replan()
            return

        # Same XY already in flight — do not cancel/reissue (that causes
        # stop→spin→jerk and false CANCELED completions).
        same_goal = (
            self._nav_goal_xy is not None
            and math.hypot(x - self._nav_goal_xy[0], y - self._nav_goal_xy[1])
            <= _SAME_GOAL_TOL_M
            and int(getattr(self, '_nav_status', 0)) in (1, 2, 3)
        )
        if same_goal:
            self.exec_handle = ExecutionHandle(execution)
            self.exec_handle.set_goal_id([self._nav_seq & 0xFF] * 16)
            self.node.get_logger().info(
                f'[{self.name}] keep Nav2 goal '
                f'[{x:.2f}, {y:.2f}] (same as in-flight)'
            )
            return

        # Only cancel when the target actually changes.
        if self.exec_handle is not None:
            self._expect_cancel = True
            self._request_stop(self.exec_handle)

        pose = PoseStamped()
        pose.header.stamp = self.node.get_clock().now().to_msg()
        pose.header.frame_id = self.map_frame
        pose.pose.position.x = float(x)
        pose.pose.position.y = float(y)
        pose.pose.position.z = 0.0
        q = quaternion_from_euler(0.0, 0.0, float(yaw))
        pose.pose.orientation.x = q[0]
        pose.pose.orientation.y = q[1]
        pose.pose.orientation.z = q[2]
        pose.pose.orientation.w = q[3]

        key = namespacify('fleet_nav_goal', self.name)
        try:
            self.zenoh_session.put(key, serialize_message(pose))
        except Exception as exc:  # noqa: BLE001
            self.node.get_logger().error(
                f'[{self.name}] zenoh put {key} failed: {exc}'
            )
            if self.update_handle is not None:
                self.update_handle.more().replan()
            return

        self._nav_seq += 1
        self._nav_status = 1  # ACCEPTED until relay reports
        self._nav_goal_xy = (float(x), float(y))
        self._abort_replanned = False
        self._expect_cancel = False
        self.exec_handle = ExecutionHandle(execution)
        # Non-None goal_id so free_fleet update() polls _is_navigation_done.
        self.exec_handle.set_goal_id([self._nav_seq & 0xFF] * 16)
        self.node.get_logger().info(
            f'Commanding [{self.name}] via fleet_nav_goal to '
            f'[{x:.2f}, {y:.2f}, {yaw:.2f}] on map [{destination.map}]'
        )

    def _handle_stop_navigation(self):
        """Cancel via fleet_nav_cancel topic (Empty)."""
        from rclpy.serialization import serialize_message
        from std_msgs.msg import Empty

        key = namespacify('fleet_nav_cancel', self.name)
        try:
            self.zenoh_session.put(key, serialize_message(Empty()))
        except Exception as exc:  # noqa: BLE001
            self.node.get_logger().warning(
                f'[{self.name}] fleet_nav_cancel put failed: {exc}'
            )
        self._nav_goal_xy = None

    def _is_navigation_done(self, nav_handle: ExecutionHandle) -> bool:
        if nav_handle.goal_id is None:
            return True
        # action_msgs/GoalStatus: 4=SUCCEEDED, 5=CANCELED, 6=ABORTED
        status = int(getattr(self, '_nav_status', 0))
        goal = getattr(self, '_nav_goal_xy', None)
        if goal is not None:
            dist = self._xy_distance_to(goal[0], goal[1])
            if dist is not None and dist <= _AT_GOAL_TOL_M:
                return True

        if status == 4:  # SUCCEEDED
            return True

        # ABORTED: path blocked / controller failed. Do NOT treat as arrival —
        # that made RMF hop to the next waypoint while the robot jerked/spun.
        if status == 6:
            if not self._abort_replanned and self.update_handle is not None:
                self._abort_replanned = True
                self.replan_counts += 1
                self.node.get_logger().warning(
                    f'[{self.name}] Nav2 ABORTED at goal {goal}; requesting replan '
                    f'(count={self.replan_counts})'
                )
                self.update_handle.more().replan()
            return False

        # CANCELED / ACCEPTED / EXECUTING / UNKNOWN: keep waiting
        return False
