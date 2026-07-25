#!/usr/bin/env python3
"""Fleet-server mapping bridge: Redis (GUI/API) ↔ ROS 2 topics over zenoh.

Discovers robots from Redis (`robot:*:ros_name`), publishes mapping_cmd /
fleet_teleop, and turns OccupancyGrid `/<name>/map` into PNG previews for the GUI.
"""

from __future__ import annotations

import json
import math
import os
import struct
import time
import zlib

import redis
import rclpy
from geometry_msgs.msg import PoseStamped, Twist
from nav_msgs.msg import OccupancyGrid
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String

MAP_QOS = QoSProfile(
    depth=1,
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.TRANSIENT_LOCAL,
)
STATUS_QOS = QoSProfile(
    depth=1,
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.TRANSIENT_LOCAL,
)
PREVIEW_MAX_SIDE = 1280


def _png_rgb(width: int, height: int, pixels: bytes) -> bytes:
    """8-bit RGB PNG (RViz / pmap style occupancy)."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    row_bytes = width * 3
    rows = b''.join(b'\x00' + pixels[i * row_bytes : (i + 1) * row_bytes] for i in range(height))
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(rows, 6))
        + chunk(b'IEND', b'')
    )


def occupancy_to_png(msg: OccupancyGrid, max_side: int = PREVIEW_MAX_SIDE):
    """Convert OccupancyGrid → high-res RViz-like RGB PNG (Y flipped for images)."""
    w = int(msg.info.width)
    h = int(msg.info.height)
    if w < 1 or h < 1 or len(msg.data) < w * h:
        return b'', {}
    scale = max(1, max(w, h) // max_side)
    ow = max(1, w // scale)
    oh = max(1, h // scale)
    out = bytearray(ow * oh * 3)
    data = msg.data
    # RViz default-ish: free light, occupied black, unknown mid-gray
    FREE = (245, 245, 245)
    OCC = (20, 20, 20)
    UNK = (112, 112, 112)
    for y in range(oh):
        # Flip Y so image row 0 is map top (ROS grid row 0 is bottom / origin).
        src_y = min(h - 1, (oh - 1 - y) * scale)
        for x in range(ow):
            src_x = min(w - 1, x * scale)
            v = int(data[src_y * w + src_x])
            if v < 0:
                r, g, b = UNK
            elif v >= 50:
                r, g, b = OCC
            else:
                # Soft probability shading for free/partial cells
                t = max(0, min(100, v)) / 100.0
                r = int(FREE[0] * (1 - t) + OCC[0] * t)
                g = int(FREE[1] * (1 - t) + OCC[1] * t)
                b = int(FREE[2] * (1 - t) + OCC[2] * t)
            i = (y * ow + x) * 3
            out[i] = r
            out[i + 1] = g
            out[i + 2] = b
    res = float(msg.info.resolution) * float(scale)
    origin = msg.info.origin.position
    meta = {
        'width': ow,
        'height': oh,
        'resolution': res,
        'originX': float(origin.x),
        'originY': float(origin.y),
        'yFlipped': True,
    }
    return _png_rgb(ow, oh, bytes(out)), meta


def yaw_from_quat(q) -> float:
    return math.atan2(
        2.0 * (q.w * q.z + q.x * q.y),
        1.0 - 2.0 * (q.y * q.y + q.z * q.z),
    )


class MappingBridgeNode(Node):
    def __init__(self, rds: redis.Redis) -> None:
        super().__init__('navpro_mapping_bridge')
        self._redis = rds
        self._robots: dict[str, dict] = {}  # robot_id -> {name, ...}
        self._last_cmd: dict[str, str] = {}
        self._map_subs: dict[str, object] = {}
        self._status_subs: dict[str, object] = {}
        self._pose_subs: dict[str, object] = {}
        self._scan_subs: dict[str, object] = {}
        self._cmd_pubs: dict[str, object] = {}
        self._fleet_pubs: dict[str, object] = {}
        self._teleop_pubs: dict[str, object] = {}
        self._poses: dict[str, dict] = {}
        self._last_fleet: dict[str, str] = {}
        # Smoothed teleop output per robot (avoids zero-spam jerk from Redis TTL gaps).
        self._teleop_smooth: dict[str, dict[str, float]] = {}
        self.create_timer(0.25, self._discover_tick)
        self.create_timer(0.05, self._teleop_tick)
        self.create_timer(0.2, self._mapping_cmd_tick)
        self.create_timer(0.5, self._fleet_cmd_tick)
        self.get_logger().info('mapping bridge up (ROS ↔ Redis)')

    def _discover_tick(self) -> None:
        try:
            keys = self._redis.keys('robot:*:ros_name')
        except redis.RedisError as exc:
            self.get_logger().warning(f'redis discover: {exc}')
            return
        seen: set[str] = set()
        for key in keys:
            key_s = key.decode() if isinstance(key, bytes) else str(key)
            # robot:<uuid>:ros_name
            parts = key_s.split(':')
            if len(parts) != 3:
                continue
            robot_id = parts[1]
            name = self._redis.get(key)
            if name is None:
                continue
            name_s = name.decode() if isinstance(name, bytes) else str(name)
            if not name_s:
                continue
            seen.add(robot_id)
            prev = self._robots.get(robot_id)
            if prev is None or prev.get('name') != name_s:
                self._robots[robot_id] = {'name': name_s}
                self._ensure_topics(robot_id, name_s)
                self.get_logger().info(f'tracking robot {name_s} ({robot_id})')
        # drop stale
        for rid in list(self._robots):
            if rid not in seen:
                self._drop_robot(rid)

    def _ensure_topics(self, robot_id: str, name: str) -> None:
        if robot_id in self._cmd_pubs:
            return
        self._cmd_pubs[robot_id] = self.create_publisher(String, f'/{name}/mapping_cmd', 10)
        self._fleet_pubs[robot_id] = self.create_publisher(String, f'/{name}/fleet_cmd', 10)
        self._teleop_pubs[robot_id] = self.create_publisher(Twist, f'/{name}/fleet_teleop', 10)
        self._map_subs[robot_id] = self.create_subscription(
            OccupancyGrid,
            f'/{name}/mapping_grid',
            lambda msg, rid=robot_id: self._on_map(rid, msg),
            MAP_QOS,
        )
        # Fallback if robot still bridges full /map (may be empty over zenoh).
        self.create_subscription(
            OccupancyGrid,
            f'/{name}/map',
            lambda msg, rid=robot_id: self._on_map(rid, msg),
            MAP_QOS,
        )
        self._status_subs[robot_id] = self.create_subscription(
            String,
            f'/{name}/mapping_status',
            lambda msg, rid=robot_id: self._on_status(rid, msg),
            STATUS_QOS,
        )
        self._pose_subs[robot_id] = self.create_subscription(
            PoseStamped,
            f'/{name}/mapping_pose',
            lambda msg, rid=robot_id: self._on_pose(rid, msg),
            10,
        )
        self._scan_subs[robot_id] = self.create_subscription(
            String,
            f'/{name}/mapping_scan',
            lambda msg, rid=robot_id: self._on_scan(rid, msg),
            10,
        )

    def _drop_robot(self, robot_id: str) -> None:
        # Keep pubs briefly if a factory_reset is still queued.
        if self._redis.get(f'robot:{robot_id}:factory_reset') is not None:
            return
        self._robots.pop(robot_id, None)
        for store in (
            self._cmd_pubs,
            self._fleet_pubs,
            self._teleop_pubs,
            self._map_subs,
            self._status_subs,
            self._pose_subs,
            self._scan_subs,
            self._poses,
            self._last_cmd,
            self._last_fleet,
            self._teleop_smooth,
        ):
            store.pop(robot_id, None)

    def _mapping_cmd_tick(self) -> None:
        for robot_id, info in list(self._robots.items()):
            raw = self._redis.get(f'robot:{robot_id}:mapping_cmd')
            if raw is None:
                continue
            text = raw.decode() if isinstance(raw, bytes) else str(raw)
            if text == self._last_cmd.get(robot_id):
                continue
            self._last_cmd[robot_id] = text
            pub = self._cmd_pubs.get(robot_id)
            if pub is None:
                continue
            msg = String()
            msg.data = text
            pub.publish(msg)
            self.get_logger().info(f'ROS mapping_cmd → /{info["name"]}/mapping_cmd')

    def _fleet_cmd_tick(self) -> None:
        """Push fleet_cmd / factory_reset over ROS /fleet_cmd."""
        try:
            keys = list(self._redis.keys('robot:*:factory_reset')) + list(
                self._redis.keys('robot:*:fleet_cmd')
            )
        except redis.RedisError:
            return
        for key in keys:
            key_s = key.decode() if isinstance(key, bytes) else str(key)
            parts = key_s.split(':')
            if len(parts) != 3:
                continue
            robot_id = parts[1]
            raw = self._redis.get(key)
            if raw is None:
                continue
            text = raw.decode() if isinstance(raw, bytes) else str(raw)
            dedupe_key = f'{key_s}:{text}'
            if dedupe_key == self._last_fleet.get(robot_id):
                continue
            name_raw = self._redis.get(f'robot:{robot_id}:ros_name')
            if name_raw is None:
                continue
            name = name_raw.decode() if isinstance(name_raw, bytes) else str(name_raw)
            if robot_id not in self._robots:
                self._robots[robot_id] = {'name': name}
                self._ensure_topics(robot_id, name)
            pub = self._fleet_pubs.get(robot_id)
            if pub is None:
                continue
            self._last_fleet[robot_id] = dedupe_key
            msg = String()
            msg.data = text
            pub.publish(msg)
            self.get_logger().warn(f'ROS fleet_cmd → /{name}/fleet_cmd')

    def _teleop_tick(self) -> None:
        # GUI writes Redis; we publish Twist at 20 Hz with light smoothing.
        # Do NOT spam zeros when idle — that jerk-stops the robot against real cmds.
        alpha = 0.35  # higher = snappier; lower = smoother
        idle_eps = 1e-3
        for robot_id in list(self._robots):
            raw = self._redis.get(f'robot:{robot_id}:teleop')
            pub = self._teleop_pubs.get(robot_id)
            if pub is None:
                continue

            target_lin = 0.0
            target_ang = 0.0
            active = False
            if raw is not None:
                try:
                    payload = json.loads(raw)
                    if not payload.get('stop'):
                        target_lin = float(payload.get('linear') or 0.0)
                        target_ang = float(payload.get('angular') or 0.0)
                        active = abs(target_lin) > idle_eps or abs(target_ang) > idle_eps
                    else:
                        active = False  # explicit stop → ramp to zero
                        target_lin = 0.0
                        target_ang = 0.0
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass

            state = self._teleop_smooth.setdefault(
                robot_id, {'lin': 0.0, 'ang': 0.0, 'publishing': False}
            )
            state['lin'] += alpha * (target_lin - state['lin'])
            state['ang'] += alpha * (target_ang - state['ang'])

            near_zero = abs(state['lin']) < idle_eps and abs(state['ang']) < idle_eps
            if active or not near_zero:
                state['publishing'] = True
                tw = Twist()
                tw.linear.x = 0.0 if abs(state['lin']) < idle_eps else state['lin']
                tw.angular.z = 0.0 if abs(state['ang']) < idle_eps else state['ang']
                pub.publish(tw)
            elif state['publishing']:
                # One clean stop frame, then silence.
                pub.publish(Twist())
                state['lin'] = 0.0
                state['ang'] = 0.0
                state['publishing'] = False


    def _on_status(self, robot_id: str, msg: String) -> None:
        try:
            payload = json.loads(msg.data or '{}')
        except json.JSONDecodeError:
            return
        state = str(payload.get('state') or 'idle')
        # Robot mode_manager historically used "mapping"; GUI expects "active".
        if state == 'mapping':
            state = 'active'
        pipe = self._redis.pipeline()
        pipe.set(f'robot:{robot_id}:mapping_state', state, ex=300)
        err = payload.get('error')
        if err:
            pipe.set(f'robot:{robot_id}:mapping_error', str(err), ex=300)
        elif state != 'error':
            pipe.delete(f'robot:{robot_id}:mapping_error')
        if state in ('idle', 'saved'):
            pipe.delete(f'robot:{robot_id}:mapping_preview')
            pipe.delete(f'robot:{robot_id}:mapping_preview_ts')
            pipe.delete(f'robot:{robot_id}:mapping_preview_meta')
            pipe.delete(f'robot:{robot_id}:mapping_scan')
            pipe.delete(f'robot:{robot_id}:mapping_pose')
            self._poses.pop(robot_id, None)
        else:
            # Lidar overlay may arrive embedded in mapping_status (zenoh-friendly).
            xy = payload.get('xy')
            if isinstance(xy, list) and len(xy) >= 2:
                if len(xy) > 800:
                    xy = xy[:800]
                scan_body = json.dumps(
                    {'xy': xy, 'ts': payload.get('ts')},
                    separators=(',', ':'),
                )
                pipe.set(f'robot:{robot_id}:mapping_scan', scan_body, ex=3)
        pipe.execute()

    def _on_pose(self, robot_id: str, msg: PoseStamped) -> None:
        pose = {
            'x': float(msg.pose.position.x),
            'y': float(msg.pose.position.y),
            'yaw': yaw_from_quat(msg.pose.orientation),
        }
        self._poses[robot_id] = pose
        # Fast path for GUI marker (do not wait for next occupancy PNG ~2s).
        try:
            body = json.dumps(pose, separators=(',', ':'))
            pipe = self._redis.pipeline()
            pipe.set(f'robot:{robot_id}:mapping_pose', body, ex=3)
            meta_raw = self._redis.get(f'robot:{robot_id}:mapping_preview_meta')
            if meta_raw is not None:
                meta = json.loads(meta_raw)
                if isinstance(meta, dict):
                    meta['pose'] = pose
                    pipe.set(
                        f'robot:{robot_id}:mapping_preview_meta',
                        json.dumps(meta, separators=(',', ':')),
                        ex=30,
                    )
            pipe.execute()
        except (redis.RedisError, json.JSONDecodeError, TypeError):
            pass

    def _on_scan(self, robot_id: str, msg: String) -> None:
        """Cache lidar points (map-frame xy flat list) for the Mapping GUI."""
        try:
            payload = json.loads(msg.data or '{}')
        except json.JSONDecodeError:
            return
        xy = payload.get('xy')
        if not isinstance(xy, list) or len(xy) < 2:
            return
        # Cap payload size for Redis / HTTP
        if len(xy) > 800:
            xy = xy[:800]
        body = json.dumps({'xy': xy, 'ts': payload.get('ts')}, separators=(',', ':'))
        self._redis.set(f'robot:{robot_id}:mapping_scan', body, ex=3)

    def _on_map(self, robot_id: str, msg: OccupancyGrid) -> None:
        png, meta = occupancy_to_png(msg)
        if not png:
            return
        pose = self._poses.get(robot_id)
        if pose:
            meta['pose'] = pose
        meta['ts'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        pipe = self._redis.pipeline()
        pipe.set(f'robot:{robot_id}:mapping_preview', png, ex=30)
        pipe.set(f'robot:{robot_id}:mapping_preview_ts', meta['ts'], ex=30)
        pipe.set(f'robot:{robot_id}:mapping_preview_meta', json.dumps(meta), ex=30)
        # First map means SLAM is live — promote out of "starting".
        cur = self._redis.get(f'robot:{robot_id}:mapping_state')
        cur_s = cur.decode() if isinstance(cur, bytes) else (str(cur) if cur else '')
        if cur_s in ('', 'starting', 'idle'):
            pipe.set(f'robot:{robot_id}:mapping_state', 'active', ex=300)
        pipe.execute()
        self.get_logger().info(
            f'map preview ← {robot_id} {meta.get("width")}x{meta.get("height")}',
            throttle_duration_sec=5.0,
        )


def main() -> None:
    redis_url = os.environ.get('REDIS_CACHE_URL', 'redis://redis-cache:6379')
    rds = redis.Redis.from_url(redis_url, decode_responses=False)
    rclpy.init()
    node = MappingBridgeNode(rds)
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
