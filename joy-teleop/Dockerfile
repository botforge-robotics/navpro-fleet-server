# USB joystick → Redis teleop (same path as GUI Drive).
# Uses joy_node + a small rclpy bridge; no zenoh needed.
FROM ros:jazzy-ros-base

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3-pip \
        ros-jazzy-joy \
        ros-jazzy-sensor-msgs \
        ros-jazzy-rclpy \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages redis==5.0.8

WORKDIR /joy
COPY joy_teleop_node.py /joy/joy_teleop_node.py
COPY entrypoint.sh /joy/entrypoint.sh
RUN chmod +x /joy/entrypoint.sh

ENV REDIS_CACHE_URL=redis://redis-cache:6379
ENV JOY_DEVICE_ID=0
ENV MAX_LINEAR=0.15
ENV MAX_ANGULAR=1.5
ENV ENABLE_BUTTON=4
ENV AXIS_LINEAR=1
ENV AXIS_ANGULAR=0
ENV DEADZONE=0.12
ENV ROS_DOMAIN_ID=42

ENTRYPOINT ["/joy/entrypoint.sh"]
