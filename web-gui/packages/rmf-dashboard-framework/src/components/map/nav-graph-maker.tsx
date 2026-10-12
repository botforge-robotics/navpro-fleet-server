import { useTheme } from '@mui/material';
import { Line } from '@react-three/drei';
import { Graph } from 'api-client';
import React from 'react';
import { Vector3 } from 'three';

interface NavGraphMakerProps {
  graphs: Graph[];
  color?: string;
  /** Height above the floor so lanes sit above the floorplan image. */
  z?: number;
}

/**
 * Draws building-map navigation graph edges (traffic lanes) as line segments.
 */
export function NavGraphMaker({
  graphs,
  color,
  z = 0.15,
}: NavGraphMakerProps): React.JSX.Element {
  const theme = useTheme();
  const lineColor = color ?? theme.palette.info.main;
  const lines: Array<{ key: string; points: Vector3[] }> = [];

  graphs.forEach((graph, gi) => {
    if (!graph?.edges?.length || !graph?.vertices?.length) return;
    graph.edges.forEach((edge, ei) => {
      const v1 = graph.vertices[edge.v1_idx];
      const v2 = graph.vertices[edge.v2_idx];
      if (!v1 || !v2) return;
      lines.push({
        key: `${gi}-${ei}-${edge.v1_idx}-${edge.v2_idx}`,
        points: [new Vector3(v1.x, v1.y, z), new Vector3(v2.x, v2.y, z)],
      });
    });
  });

  return (
    <>
      {lines.map((line) => (
        <Line key={line.key} points={line.points} color={lineColor} linewidth={3} />
      ))}
    </>
  );
}
