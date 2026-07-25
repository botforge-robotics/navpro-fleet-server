import { Circle } from '@react-three/drei';
import { MeshProps, ThreeEvent, useFrame } from '@react-three/fiber';
import React from 'react';
import { Euler, MeshBasicMaterial, Vector3 } from 'three';

import { RobotData } from './robot-three-maker';

/** Theme error.dark from uidesign.json — fixed robot marker color. */
const ROBOT_DOT_RED = '#EF4444';

interface CircleShapeProps extends MeshProps {
  position: Vector3;
  rotation: Euler;
  onRobotClick?: (ev: ThreeEvent<MouseEvent>) => void;
  robot: RobotData;
  segment: number;
}

/** Live robot as a small red flashing dot on the map. */
export const CircleShape = ({
  position,
  rotation,
  onRobotClick,
  robot,
  segment,
  onPointerOver,
  onPointerOut,
}: CircleShapeProps): JSX.Element => {
  // Compact dot (~0.22–0.32 m) so robots read as points, not discs.
  const SCALED_RADIUS = Math.max(0.18, Math.min(0.32, robot.footprint * 0.45));
  const materialRef = React.useRef<MeshBasicMaterial>(null);
  const glowRef = React.useRef<MeshBasicMaterial>(null);
  const phase = React.useRef(Math.random() * Math.PI * 2);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 5.5 + phase.current;
    // Sharp flash: mostly bright, brief dim — reads as a blinking LED.
    const flash = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t));
    if (materialRef.current) {
      materialRef.current.opacity = flash;
      materialRef.current.transparent = true;
    }
    if (glowRef.current) {
      glowRef.current.opacity = flash * 0.35;
      glowRef.current.transparent = true;
    }
  });

  return (
    <>
      <Circle
        args={[SCALED_RADIUS * 1.85, segment]}
        position={new Vector3(position.x, position.y, position.z - 0.01)}
        rotation={rotation}
      >
        <meshBasicMaterial ref={glowRef} color={ROBOT_DOT_RED} transparent opacity={0.3} />
      </Circle>
      <Circle
        args={[SCALED_RADIUS, segment]}
        position={position}
        rotation={rotation}
        onClick={onRobotClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <meshBasicMaterial ref={materialRef} color={ROBOT_DOT_RED} transparent opacity={0.95} />
      </Circle>
    </>
  );
};
