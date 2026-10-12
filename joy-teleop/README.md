# USB joystick teleop for the fleet server.
#
# Plug an Xbox/XInput (or similar) pad into the host, then:
#   docker compose --profile joy up -d --build joy-teleop
#
# Hold RB to drive. USB is armed only while Map Drive pad is open for that robot.
#
# Env (optional):
#   JOY_DEVICE_ID=0                 # /dev/input/js0
#   JOY_ENABLE_BUTTON=5             # Xbox RB
