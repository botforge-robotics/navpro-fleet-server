import { Line } from '@react-three/drei';
import React from 'react';
import { Vector3 } from 'three';

import type { TrajectoryData } from '../../services';

interface TrajectoryThreeProps {
  trajData: TrajectoryData;
  /** Height above floor (upstream rmf-web uses z=4). */
  z?: number;
}

/**
 * Draw the RMF schedule trajectory exactly as returned by the trajectory
 * server — same as open-rmf/rmf-web (raw segment knots, no nearest-waypoint
 * snapping or graph BFS expansion).
 */
export function TrajectoryThree({
  trajData,
  z = 4,
}: TrajectoryThreeProps): React.JSX.Element | null {
  const points = React.useMemo(() => {
    const segs = trajData.trajectory.segments;
    if (!segs?.length) return [];
    const pts: Vector3[] = [];
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    for (const seg of segs) {
      const x = seg.x[0];
      const y = seg.x[1];
      if (x === lastX && y === lastY) continue;
      pts.push(new Vector3(x, y, z));
      lastX = x;
      lastY = y;
    }
    return pts;
  }, [trajData.trajectory.segments, z]);

  if (points.length < 2) {
    return null;
  }

  const color = trajData.conflict ? '#e53935' : trajData.color || '#43a047';
  // Slightly thicker than upstream linewidth=5 so the path stays readable
  // when traffic lanes are hidden.
  const width = Math.max(5, (trajData.trajectory.dimensions || 0.3) * 18);

  return (
    <group>
      <Line points={points} color="#ffffff" lineWidth={width + 3} linewidth={width + 3} transparent opacity={0.3} />
      <Line points={points} color={color} lineWidth={width} linewidth={width} />
    </group>
  );
}
