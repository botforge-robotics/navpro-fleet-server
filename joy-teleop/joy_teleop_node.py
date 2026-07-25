#!/usr/bin/env python3
"""USB joystick → Redis teleop (same keys as platform GUI Drive).

USB stick is armed ONLY while the on-screen Drive pad is open:
  Redis fleet:joy_session = {"id","name","armed":true} with short TTL
  refreshed by the GUI. When the pad closes (or TTL expires), USB is idle.

Hold enable button (default RB / button 5) to drive that robot only.
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional

import redis
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Joy


def _fenv(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _ienv(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class JoyTeleopBridge(Node):
    def __init__(self) -> None:
        super().__init__('navpro_joy_teleop')
        url = os.environ.get('REDIS_CACHE_URL', 'redis://redis-cache:6379')
        self._redis = redis.Redis.from_url(url, decode_responses=False)
        self._max_lin = _fenv('MAX_LINEAR', 0.15)
        self._max_ang = _fenv('MAX_ANGULAR', 1.5)
        self._deadzone = _fenv('DEADZONE', 0.12)
        self._axis_lin = _ienv('AXIS_LINEAR', 1)
        self._axis_ang = _ienv('AXIS_ANGULAR', 0)
        # Xbox RB = 5 (was LB = 4).
        self._enable_btn = _ienv('ENABLE_BUTTON', 5)
        self._invert_lin = os.environ.get('INVERT_LINEAR', '0') in ('1', 'true', 'True')
        self._invert_ang = os.environ.get('INVERT_ANGULAR', '0') in ('1', 'true', 'True')

        self._target_id: Optional[str] = None
        self._target_name: Optional[str] = None
        self._armed = False
        self._last_log = 0.0
        self._last_publish = 0.0
        self._last_armed_log = False

        self.create_subscription(Joy, '/joy', self._on_joy, 10)
        self.create_timer(0.25, self._resolve_session)
        self._resolve_session()
        self.get_logger().info(
            f'joy→Redis teleop ready (enable=RB btn={self._enable_btn}, '
            f'max_lin={self._max_lin}, max_ang={self._max_ang}; '
            'USB armed only while Map Drive pad is open)'
        )

    def _resolve_session(self) -> None:
        """Only accept an armed GUI session — never free-drive without the pad."""
        try:
            raw = self._redis.get('fleet:joy_session')
        except redis.RedisError:
            raw = None

        armed = False
        rid: Optional[str] = None
        name: Optional[str] = None
        if raw is not None:
            try:
                text = raw.decode() if isinstance(raw, bytes) else str(raw)
                payload = json.loads(text)
                if payload.get('armed') is True:
                    rid = str(payload.get('id') or '').strip() or None
                    name = str(payload.get('name') or '').strip() or None
                    armed = bool(rid and name)
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

        if armed != self._armed or (armed and rid != self._target_id):
            if armed:
                self.get_logger().info(f'USB joy ARMED → {name} ({(rid or "")[:8]}…)')
            elif self._armed:
                self.get_logger().info('USB joy DISARMED (Drive pad closed)')
            self._last_armed_log = armed

        self._armed = armed
        self._target_id = rid if armed else None
        self._target_name = name if armed else None

    def _axis(self, axes: list[float], index: int) -> float:
        if index < 0 or index >= len(axes):
            return 0.0
        v = float(axes[index])
        if abs(v) < self._deadzone:
            return 0.0
        sign = 1.0 if v > 0 else -1.0
        return sign * min(1.0, (abs(v) - self._deadzone) / (1.0 - self._deadzone))

    def _on_joy(self, msg: Joy) -> None:
        if not self._armed or not self._target_id or not self._target_name:
            return

        buttons = list(msg.buttons)
        axes = list(msg.axes)
        enabled = (
            buttons[self._enable_btn] == 1 if self._enable_btn < len(buttons) else False
        )
        if not enabled:
            return

        lin = self._axis(axes, self._axis_lin) * self._max_lin
        ang = self._axis(axes, self._axis_ang) * self._max_ang
        if self._invert_lin:
            lin = -lin
        if self._invert_ang:
            ang = -ang

        stopped = abs(lin) < 1e-3 and abs(ang) < 1e-3
        payload = json.dumps(
            {
                'linear': lin,
                'angular': ang,
                'stop': stopped,
                'robotName': self._target_name,
                'source': 'usb_joy',
                'ts': int(time.time() * 1000),
            }
        )
        try:
            pipe = self._redis.pipeline()
            pipe.set(f'robot:{self._target_id}:ros_name', self._target_name, ex=86400)
            pipe.set(
                f'robot:{self._target_id}:teleop',
                payload,
                ex=1 if stopped else 3,
            )
            pipe.execute()
        except redis.RedisError as exc:
            now = time.time()
            if now - self._last_log > 5.0:
                self.get_logger().error(f'Redis teleop write failed: {exc}')
                self._last_log = now
            return

        now = time.time()
        if now - self._last_publish > 2.0 and not stopped:
            self.get_logger().info(
                f'joy → {self._target_name}: lin={lin:.2f} ang={ang:.2f}'
            )
            self._last_publish = now


def main() -> None:
    rclpy.init()
    node = JoyTeleopBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
