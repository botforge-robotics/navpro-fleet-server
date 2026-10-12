# Safety Layer - independent of the platform (design invariant)

Safety is not an emergent property of "robot holds position on network
partition". It is a first-class invariant, verified at robot integration:

1. **Hardware e-stop cuts motor power at the ESP32/motor-driver level** with
   zero dependency on the Pi software stack, RMF, zenoh, or server
   connectivity. The platform heartbeat merely *reports* e-stop state
   (`estop` field); it plays no role in enforcing it.
2. **Local obstacle avoidance** (Nav2 costmap-based collision avoidance running
   on the Pi) functions fully with the server unreachable. A robot mid-lane
   with no fleet connectivity will not hit a person or obstacle.
3. **Command-loss behavior**: if the zenoh link drops mid-navigation, the robot
   completes or aborts its current Nav2 goal locally and holds. It never
   continues on stale fleet instructions. (Implemented robot-side; the fleet
   adapter re-syncs state on reconnect.)
4. **Nothing platform-side is in the safety path**: RMF, the Platform API,
   device plugins, and OTA are all outside it. OTA never flashes while the
   robot is executing a task (enforced by the rollout state machine - a robot
   only pulls `staged` artifacts when idle).

## Verification (part of robot integration sign-off)

- [ ] Press hardware e-stop while a task runs: motors cut instantly with the
      Pi halted (pull power to prove independence).
- [ ] Disconnect the server mid-navigation: robot finishes/aborts the current
      goal, holds, and does not re-plan across shared zones until reconnect.
- [ ] Walk in front of the robot with the server down: Nav2 local costmap
      stops/avoids as normal.
