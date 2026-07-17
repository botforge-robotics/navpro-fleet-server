import type { LevelTransform, RobotPose } from '../../api/types';

/**
 * Map a robot pose from its SLAM map frame into building coordinates using
 * the per-robot/per-level transform (rotation, scale, translation), matching
 * the free_fleet_adapter fleet-config Transformation convention.
 */
export function robotToBuilding(
  pose: RobotPose,
  transform: LevelTransform | undefined,
): { x: number; y: number } {
  if (transform === undefined) {
    return { x: pose.x, y: pose.y };
  }
  const cos = Math.cos(transform.yaw);
  const sin = Math.sin(transform.yaw);
  return {
    x: transform.scale * (pose.x * cos - pose.y * sin) + transform.x,
    y: transform.scale * (pose.x * sin + pose.y * cos) + transform.y,
  };
}

/**
 * Building coordinates (meters, origin at floorplan image bottom-left) to
 * image pixel coordinates (origin top-left).
 */
export function buildingToImagePx(
  point: { x: number; y: number },
  level: { metersPerPixel: number; originX: number; originY: number },
  imageHeightPx: number,
): { xPx: number; yPx: number } {
  return {
    xPx: (point.x - level.originX) / level.metersPerPixel,
    yPx: imageHeightPx - (point.y - level.originY) / level.metersPerPixel,
  };
}
