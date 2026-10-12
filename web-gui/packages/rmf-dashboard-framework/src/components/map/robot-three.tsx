import robotoFont from '@fontsource/roboto/files/roboto-latin-400-normal.woff';
import { ThreeEvent } from '@react-three/fiber';
import React from 'react';
import { Euler, Vector3 } from 'three';

import { RobotData, RobotThreeMaker } from './robot-three-maker';

interface RobotThreeProps {
  robot: RobotData;
  robotLocation: [number, number, number];
  onRobotClick?: (ev: ThreeEvent<MouseEvent>, robot: RobotData) => void;
  robotLabel: boolean;
}

export const RobotThree = ({ robot, robotLocation, onRobotClick, robotLabel }: RobotThreeProps) => {
  const STANDAR_Z_POSITION = 5;
  const CIRCLE_SEGMENT = 24;

  const robotId = `${robot.fleet}/${robot.name}`;
  // Upstream rmf-web subtracts π for icon sprites that face −X. NavPro uses
  // circle + heading ray (no icon), so RMF yaw must map 1:1 (0 = +X).
  const rotationZ = robot.iconPath
    ? robotLocation[2] - Math.PI
    : robotLocation[2];

  const position = new Vector3(robotLocation[0], robotLocation[1], STANDAR_Z_POSITION);

  return (
    <React.Fragment key={robotId}>
      <RobotThreeMaker
        robot={robot}
        imageUrl={robot.iconPath}
        position={position}
        onRobotClick={onRobotClick}
        rotation={new Euler(0, 0, rotationZ)}
        circleSegment={CIRCLE_SEGMENT}
        fontPath={robotoFont}
        robotLabel={robotLabel}
      />
    </React.Fragment>
  );
};
