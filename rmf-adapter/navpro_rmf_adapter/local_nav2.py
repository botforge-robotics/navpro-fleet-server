"""Optional Nav2 control via a host-side goal bridge.

free_fleet's default path talks to Nav2 only through zenoh action keys. In the
host-network cafe sim zenoh send_goal often times out, and an in-container
rclpy ActionClient frequently never receives accept/result callbacks.

Set NAVPRO_LOCAL_NAV2=1 to publish PoseStamped goals on:
  /{robot}/rmf_nav_goal
and read status from:
  /{robot}/rmf_nav_status  (std_msgs/Int32 = action_msgs/GoalStatus)

Run scripts/sim/nav2_goal_bridge.py on the host (same ROS_DOMAIN_ID) so those
topics become real NavigateToPose goals.

Live fleet pose comes from DDS /{robot}/odom only — free_fleet's zenoh TF
mirror is often stale and must not be used for RobotState updates.
"""

from __future__ import annotations

import logging
import math
import threading
import time
import uuid

from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import Odometry
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import Empty, Int32
from tf2_msgs.msg import TFMessage
from tf_transformations import euler_from_quaternion, quaternion_from_euler

from free_fleet_adapter.nav2_robot_adapter import Nav2RobotAdapter
from free_fleet_adapter.robot_adapter import ExecutionHandle

_LOGGER = logging.getLogger(__name__)


class GoalStatus:
    STATUS_UNKNOWN = 0
    STATUS_ACCEPTED = 1
    STATUS_EXECUTING = 2
    STATUS_CANCELING = 3
    STATUS_SUCCEEDED = 4
    STATUS_CANCELED = 5
    STATUS_ABORTED = 6


_REPLAN_COOLDOWN_S = 8.0
# Must be tighter than lane spacing near doors/pantry (~0.4 m) or we
# declare "arrived" on the approach lane and RMF replans forever.
_GOAL_XY_TOL = 0.25
_GOAL_DUPLICATE_TOL_M = 0.35
# VOLATILE: TRANSIENT_LOCAL often fails across CycloneDDS↔FastRTPS hosts.
_STATUS_QOS = QoSProfile(
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.VOLATILE,
)
_STATUS_QOS_BE = QoSProfile(
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
)
# Match Gazebo/ros_gz bridge and allow BEST_EFFORT publishers too.
_ODOM_QOS = QoSProfile(
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
)
_ODOM_QOS_RELIABLE = QoSProfile(
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.VOLATILE,
)


class LocalNav2RobotAdapter(Nav2RobotAdapter):
    """Nav2RobotAdapter that drives Nav2 through the host goal bridge."""

    def __init__(self, *args, **kwargs):
        # Parent __init__ spins until get_pose() returns. free_fleet waits on
        # zenoh TF (often missing). Subscribe to DDS /odom BEFORE super() so
        # the parent wait can finish from live Gazebo odometry.
        self._goal_status: int | None = None
        self._goal_lock = threading.Lock()
        self._last_replan_mono = 0.0
        self._goal_xy: tuple[float, float] | None = None
        self._goal_seq = 0
        self._seen_executing_seq = -1
        self._dds_pose: list[float] | None = None
        self._odom_count = 0
        self._tf_count = 0
        self._last_pose_log_mono = 0.0
        self._goal_pub = None
        self._cancel_pub = None
        self._pose_cb_group = ReentrantCallbackGroup()
        self._pose_thread = None
        self._pose_node = None
        self._pose_stop = None
        self._pose_subs = []

        name = args[0] if args else kwargs.get('name')
        node = args[4] if len(args) > 4 else kwargs.get('node')
        if name is None or node is None:
            raise TypeError('LocalNav2RobotAdapter requires name and node')
        # Parent sets self.name / self.node; set early for callbacks.
        self.name = name
        self.node = node
        self._subscribe_pose_sources(name)

        super().__init__(*args, **kwargs)

        self._goal_pub = self.node.create_publisher(
            PoseStamped, f'/{self.name}/rmf_nav_goal', 10
        )
        self._cancel_pub = self.node.create_publisher(
            Empty, f'/{self.name}/rmf_nav_cancel', 10
        )
        self.node.create_subscription(
            Int32,
            f'/{self.name}/rmf_nav_status',
            self._on_status,
            _STATUS_QOS,
            callback_group=self._pose_cb_group,
        )
        self.node.create_subscription(
            Int32,
            f'/{self.name}/rmf_nav_status',
            self._on_status,
            _STATUS_QOS_BE,
            callback_group=self._pose_cb_group,
        )
        self.node.get_logger().info(
            f'[{self.name}] LOCAL Nav2 via /{self.name}/rmf_nav_goal '
            f'(host bridge required; pose from /{self.name}/odom + /tf)'
        )

    _POSE_THREADS: dict = {}

    def _subscribe_pose_sources(self, name: str) -> None:
        """DDS odom + stripped TF on a dedicated node/thread.

        free_fleet's command-handle node often stops delivering odom callbacks
        after Nav2RobotAdapter.__init__ (mutually exclusive / executor handoff).
        A private node spun in its own thread keeps fleet pose live.
        """
        if name in LocalNav2RobotAdapter._POSE_THREADS:
            # Reuse existing thread; re-bind callbacks to this instance.
            LocalNav2RobotAdapter._POSE_THREADS[name]["adapter"] = self
            self._pose_thread = LocalNav2RobotAdapter._POSE_THREADS[name]["thread"]
            return
        if getattr(self, '_pose_thread', None) is not None:
            return

        import rclpy
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.node import Node as RclpyNode

        pose_node = RclpyNode(f'{name}_navpro_pose')
        try:
            pose_node.set_parameters([
                rclpy.parameter.Parameter(
                    'use_sim_time', rclpy.Parameter.Type.BOOL, True
                )
            ])
        except Exception:  # noqa: BLE001 - sim time optional
            pass

        def _odom_cb(msg, n=name):
            ad = LocalNav2RobotAdapter._POSE_THREADS.get(n, {}).get("adapter")
            if ad is not None:
                ad._on_odom(msg)

        def _tf_cb(msg, n=name):
            ad = LocalNav2RobotAdapter._POSE_THREADS.get(n, {}).get("adapter")
            if ad is not None:
                ad._on_tf(msg)

        self._pose_subs = []
        self._pose_subs.append(
            pose_node.create_subscription(
                Odometry, f'/{name}/odom', _odom_cb, _ODOM_QOS_RELIABLE
            )
        )
        self._pose_subs.append(
            pose_node.create_subscription(
                Odometry, f'/{name}/odom', _odom_cb, _ODOM_QOS
            )
        )
        self._pose_subs.append(
            pose_node.create_subscription(
                TFMessage, '/tf', _tf_cb, _ODOM_QOS_RELIABLE
            )
        )
        self._pose_subs.append(
            pose_node.create_subscription(
                TFMessage, f'/{name}/tf', _tf_cb, _ODOM_QOS_RELIABLE
            )
        )
        self._pose_node = pose_node
        self._pose_stop = threading.Event()
        # Private executor — never use rclpy.spin_once(node) here; that grabs
        # the global executor and breaks Nav2RobotAdapter init ("already spinning").
        pose_executor = SingleThreadedExecutor()
        pose_executor.add_node(pose_node)

        def _spin():
            while not self._pose_stop.is_set() and rclpy.ok():
                try:
                    pose_executor.spin_once(timeout_sec=0.05)
                except Exception:  # noqa: BLE001
                    time.sleep(0.05)

        self._pose_thread = threading.Thread(
            target=_spin, name=f'{name}-pose', daemon=True
        )
        LocalNav2RobotAdapter._POSE_THREADS[name] = {
            "thread": self._pose_thread,
            "adapter": self,
            "node": pose_node,
            "stop": self._pose_stop,
            "executor": pose_executor,
        }
        self._pose_thread.start()
        self.node.get_logger().info(
            f'[{name}] pose thread subscribed to /{name}/odom and /tf'
        )

    def _set_pose(self, x: float, y: float, yaw: float, source: str) -> None:
        with self._goal_lock:
            self._dds_pose = [float(x), float(y), float(yaw)]
            if source == 'odom':
                self._odom_count += 1
            else:
                self._tf_count += 1
            count = self._odom_count
            tf_count = self._tf_count
            pose = list(self._dds_pose)
        now = time.monotonic()
        if now - self._last_pose_log_mono >= 5.0:
            self._last_pose_log_mono = now
            self.node.get_logger().info(
                f'[{self.name}] pose ({pose[0]:.2f}, {pose[1]:.2f}, '
                f'yaw={pose[2]:.2f}) odom_n={count} tf_n={tf_count}'
            )

    def _on_odom(self, msg: Odometry) -> None:
        p = msg.pose.pose.position
        q = msg.pose.pose.orientation
        yaw = euler_from_quaternion([q.x, q.y, q.z, q.w])[2]
        self._set_pose(p.x, p.y, yaw, 'odom')

    def _on_tf(self, msg: TFMessage) -> None:
        # Only namespaced frames. Bare odom→base_link on shared /tf is
        # ambiguous in multi-robot sims and can steal another robot's pose.
        ns = self.name
        wanted = (
            (f'{ns}/odom', f'{ns}/base_link'),
            (f'{ns}/odom', f'{ns}/base_footprint'),
        )
        for t in msg.transforms:
            parent = t.header.frame_id.lstrip('/')
            child = t.child_frame_id.lstrip('/')
            if (parent, child) not in wanted:
                continue
            tr = t.transform.translation
            q = t.transform.rotation
            yaw = euler_from_quaternion([q.x, q.y, q.z, q.w])[2]
            self._set_pose(tr.x, tr.y, yaw, 'tf')
            return

    def get_pose(self):
        """Return live DDS odom/TF pose. Never use free_fleet zenoh TF (stale)."""
        lock = getattr(self, '_goal_lock', None)
        if lock is not None:
            with lock:
                pose = self._dds_pose
            if pose is not None:
                return list(pose)
        return None

    def _on_status(self, msg: Int32) -> None:
        with self._goal_lock:
            prev = self._goal_status
            new = int(msg.data)
            seq = self._goal_seq
            seen_exec = self._seen_executing_seq
            # Late CANCELED/ABORTED from the previous Nav2 goal often arrives
            # after we already issued the next goal (status ACCEPTED). Treating
            # that as failure causes replan loops and can strand the robot.
            if (
                new
                in (GoalStatus.STATUS_CANCELED, GoalStatus.STATUS_ABORTED)
                and seen_exec != seq
                and prev
                in (
                    GoalStatus.STATUS_ACCEPTED,
                    GoalStatus.STATUS_UNKNOWN,
                )
            ):
                return
            self._goal_status = new
            if new == GoalStatus.STATUS_EXECUTING:
                self._seen_executing_seq = seq
            seen_exec = self._seen_executing_seq
        if prev != new and new in (
            GoalStatus.STATUS_SUCCEEDED,
            GoalStatus.STATUS_ABORTED,
            GoalStatus.STATUS_CANCELED,
            GoalStatus.STATUS_EXECUTING,
        ):
            self.node.get_logger().info(
                f'[{self.name}] rmf_nav_status -> {new} '
                f'(seq={seq} seen_exec={seen_exec})'
            )

    def _handle_navigate_to_pose(
        self,
        map_name: str,
        x: float,
        y: float,
        z: float,
        yaw: float,
        nav_handle: ExecutionHandle,
    ):
        if map_name != self.map_name:
            self.replan_counts += 1
            self.node.get_logger().error(
                f'Destination map [{map_name}] != robot map [{self.map_name}]'
            )
            if self.update_handle is not None:
                self.update_handle.more().replan()
            return

        pose = PoseStamped()
        pose.header.stamp = self.node.get_clock().now().to_msg()
        pose.header.frame_id = self.map_frame or 'map'
        pose.pose.position.x = float(x)
        pose.pose.position.y = float(y)
        pose.pose.position.z = float(z)
        # Face the travel direction so RotationShim does not hunt lane yaw.
        pose_now = self.get_pose()
        use_yaw = float(yaw)
        if pose_now is not None:
            dx = float(x) - float(pose_now[0])
            dy = float(y) - float(pose_now[1])
            if math.hypot(dx, dy) > 0.05:
                use_yaw = math.atan2(dy, dx)
        q = quaternion_from_euler(0.0, 0.0, use_yaw)
        pose.pose.orientation.x = q[0]
        pose.pose.orientation.y = q[1]
        pose.pose.orientation.z = q[2]
        pose.pose.orientation.w = q[3]

        with self._goal_lock:
            if (
                self._goal_xy is not None
                and math.hypot(x - self._goal_xy[0], y - self._goal_xy[1])
                < _GOAL_DUPLICATE_TOL_M
                and self._goal_status
                in (
                    GoalStatus.STATUS_ACCEPTED,
                    GoalStatus.STATUS_EXECUTING,
                )
            ):
                return

        goal_id = str(uuid.uuid4())
        with self._goal_lock:
            self._goal_seq += 1
            self._goal_status = GoalStatus.STATUS_ACCEPTED
            self._goal_xy = (float(x), float(y))
            # Do not treat a retained TRANSIENT_LOCAL SUCCEEDED as this goal.
            self._seen_executing_seq = -1

        self.node.get_logger().info(
            f'[{self.name}] publishing rmf_nav_goal -> ({x:.2f}, {y:.2f})'
        )
        self._goal_pub.publish(pose)
        nav_handle.set_goal_id(
            list(goal_id.encode('utf-8')[:16].ljust(16, b'\0'))
        )

    def _handle_stop_navigation(self):
        with self._goal_lock:
            self._goal_status = GoalStatus.STATUS_CANCELED
            self._goal_xy = None
            self._goal_seq += 1
            self._seen_executing_seq = -1
        self._cancel_pub.publish(Empty())
        self.node.get_logger().info(f'[{self.name}] canceled Nav2 goal')

    def _near_goal(self) -> bool:
        with self._goal_lock:
            target = self._goal_xy
        if target is None:
            return False
        pose = self.get_pose()
        if pose is None:
            return False
        return math.hypot(pose[0] - target[0], pose[1] - target[1]) <= _GOAL_XY_TOL

    def _is_navigation_done(self, nav_handle: ExecutionHandle) -> bool:
        if nav_handle.goal_id is None:
            return True
        with self._goal_lock:
            status = self._goal_status
            seq = self._goal_seq
            seen_exec = self._seen_executing_seq

        # Pose tolerance can finish even if status DDS is flaky — including
        # CANCELED (goal thrash after arrival still counts as "there").
        if self._near_goal() and status in (
            GoalStatus.STATUS_EXECUTING,
            GoalStatus.STATUS_ACCEPTED,
            GoalStatus.STATUS_SUCCEEDED,
            GoalStatus.STATUS_CANCELED,
            GoalStatus.STATUS_UNKNOWN,
            None,
        ):
            self.node.get_logger().info(
                f'[{self.name}] navigation goal reached (pose tol)'
            )
            with self._goal_lock:
                self._goal_status = GoalStatus.STATUS_UNKNOWN
                self._goal_xy = None
            return True

        # Require EXECUTING for this seq before SUCCEEDED counts.
        if status == GoalStatus.STATUS_SUCCEEDED and seen_exec == seq:
            self.node.get_logger().info(
                f'[{self.name}] navigation goal reached'
            )
            with self._goal_lock:
                self._goal_status = GoalStatus.STATUS_UNKNOWN
                self._goal_xy = None
            return True

        # Bridge sometimes reports ABORTED/CANCELED right as Nav2 finishes.
        # Only treat as arrived if we actually ran this goal and are on target.
        if (
            self._near_goal()
            and seen_exec == seq
            and status
            in (GoalStatus.STATUS_ABORTED, GoalStatus.STATUS_CANCELED)
        ):
            self.node.get_logger().info(
                f'[{self.name}] navigation goal reached '
                f'(near goal after exec, status={status})'
            )
            with self._goal_lock:
                self._goal_status = GoalStatus.STATUS_UNKNOWN
                self._goal_xy = None
            return True

        if status is None:
            return False
        if status in (
            GoalStatus.STATUS_EXECUTING,
            GoalStatus.STATUS_ACCEPTED,
            GoalStatus.STATUS_CANCELING,
            GoalStatus.STATUS_UNKNOWN,
            GoalStatus.STATUS_SUCCEEDED,  # stale until seen_exec matches
        ):
            return False

        # Canceled mid-route: wait for the next command; do NOT mark done
        # (that caused pantry DoorClose + "too far from path" replan loops).
        # Also ignore cancel/abort that belongs to the *previous* goal seq.
        if status in (
            GoalStatus.STATUS_CANCELED,
            GoalStatus.STATUS_ABORTED,
        ):
            if seen_exec != seq:
                return False
            now = time.monotonic()
            if now - self._last_replan_mono < _REPLAN_COOLDOWN_S:
                return False
            if self._near_goal():
                return False
            self._last_replan_mono = now
            self.replan_counts += 1
            self.node.get_logger().warn(
                f'[{self.name}] navigation status {status} off-goal; '
                f'replan [{self.replan_counts}]'
            )
            if self.update_handle is not None:
                self.update_handle.more().replan()
            return False

        now = time.monotonic()
        if now - self._last_replan_mono < _REPLAN_COOLDOWN_S:
            return False
        self._last_replan_mono = now
        self.replan_counts += 1
        self.node.get_logger().error(
            f'[{self.name}] navigation status {status}, replan '
            f'[{self.replan_counts}] — if rejected, publish '
            f'/{self.name}/initialpose with frame_id=map'
        )
        if self.update_handle is not None:
            self.update_handle.more().replan()
        return False
