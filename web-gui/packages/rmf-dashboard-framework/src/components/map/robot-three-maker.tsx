import { useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Html, Text } from '@react-three/drei';
import { MeshProps, ThreeEvent, useLoader } from '@react-three/fiber';
import React from 'react';
import { Color, Euler, Texture, TextureLoader, Vector3 } from 'three';

import { CircleShape } from './circle-shape';
import { debounce } from './shape-three-rendering';
import { TextThreeRendering } from './text-maker';

export interface RobotData {
  fleet: string;
  name: string;
  model: string;
  footprint: number;
  scale: number;
  color: string;
  inConflict?: boolean;
  iconPath?: string;
}

interface RobotThreeMakerProps {
  imageUrl?: string;
  robot: RobotData;
  position: Vector3;
  onRobotClick?: (ev: ThreeEvent<MouseEvent>, robot: RobotData) => void;
  rotation: Euler;
  circleSegment: number;
  fontPath?: string;
  robotLabel: boolean;
}

interface RobotImageMakerProps extends MeshProps {
  imageUrl: string;
  robot: RobotData;
  position: Vector3;
  onRobotClick?: (ev: ThreeEvent<MouseEvent>, robot: RobotData) => void;
  rotation: Euler;
}

const RobotImageMaker = ({
  imageUrl,
  position,
  rotation,
  onRobotClick,
  robot,
  ...otherProps
}: RobotImageMakerProps): JSX.Element => {
  const alphaTestThreshold = 0.5;
  const texture: Texture | undefined = useLoader(TextureLoader, imageUrl, undefined, (err) => {
    console.error(`Error loading image from ${imageUrl}:`, err);
  });

  if (!texture) {
    console.error(`Failed to create image texture with ${robot.iconPath}.`);
    return <></>;
  }

  return (
    <>
      <mesh
        position={position}
        rotation={new Euler(0, 0, rotation.z)}
        onClick={(ev: ThreeEvent<MouseEvent>) => onRobotClick && onRobotClick(ev, robot)}
        {...otherProps}
      >
        <planeGeometry
          attach="geometry"
          args={[texture.image.width * robot.scale, texture.image.height * robot.scale]}
        />
        <meshBasicMaterial
          attach="material"
          map={texture}
          color={new Color(robot.color)}
          alphaTest={alphaTestThreshold}
          toneMapped={false}
        />
      </mesh>
    </>
  );
};

export const RobotThreeMaker = ({
  imageUrl,
  robot,
  position,
  onRobotClick,
  rotation,
  circleSegment,
  fontPath,
  robotLabel,
}: RobotThreeMakerProps): JSX.Element => {
  const theme = useTheme();
  const [isHovered, setIsHovered] = React.useState(false);

  const debouncedHandlePointerOver = debounce(() => {
    setIsHovered(true);
  }, 300);

  const debouncedHandlePointerOut = debounce(() => {
    setIsHovered(false);
  }, 300);

  const scaleFactor = isHovered ? 2 : 1.0;

  return (
    <>
      {isHovered && (
        <mesh position={position} scale={[0.5, 0.5, 0.5]}>
          <Html zIndexRange={[1]}>
            <div
              style={{
                backgroundColor: alpha(theme.palette.background.default, 0.82),
                color: theme.palette.text.primary,
                border: `1px solid ${theme.palette.divider}`,
                padding: '0.25rem 0.5rem',
                borderRadius: '8px',
                fontSize: '0.65rem',
                fontWeight: 600,
                transform: `scale(${scaleFactor})`,
                transition: 'transform 0.2s ease',
              }}
            >
              {robot.name}
            </div>
          </Html>
        </mesh>
      )}
      {robotLabel && fontPath && fontPath.length > 0 ? (
        <Text color="black" font={fontPath} fontSize={0.5} position={position}>
          {robot.name}
        </Text>
      ) : robotLabel ? (
        <TextThreeRendering position={[position.x, position.y, 1]} text={robot.name} />
      ) : null}
      {imageUrl ? (
        <RobotImageMaker
          imageUrl={imageUrl}
          position={position}
          rotation={rotation}
          onRobotClick={(ev: ThreeEvent<MouseEvent>) => onRobotClick && onRobotClick(ev, robot)}
          robot={robot}
          onPointerOver={debouncedHandlePointerOver}
          onPointerOut={debouncedHandlePointerOut}
        />
      ) : (
        <CircleShape
          position={position}
          rotation={rotation}
          onRobotClick={(ev: ThreeEvent<MouseEvent>) => onRobotClick && onRobotClick(ev, robot)}
          robot={robot}
          segment={circleSegment}
          onPointerOver={debouncedHandlePointerOver}
          onPointerOut={debouncedHandlePointerOut}
        />
      )}
    </>
  );
};
