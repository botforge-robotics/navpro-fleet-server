import { useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Circle, Html } from '@react-three/drei';
import React from 'react';

interface ShapeThreeRenderingProps {
  position: [number, number, number];
  color: string;
  text?: string;
  circleShape: boolean;
}

export const debounce = (callback: () => void, delay: number): (() => void) => {
  let timeoutId: number | null = null;

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = window.setTimeout(() => {
      callback();
    }, delay);
  };
};

export const ShapeThreeRendering = ({
  position,
  color,
  text,
  circleShape,
}: ShapeThreeRenderingProps): JSX.Element => {
  const theme = useTheme();
  const HEIGHT = 8;
  const ELEVATION = 0;
  const positionZ = HEIGHT / 2 + ELEVATION;
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
      {circleShape ? (
        <Circle args={[0.3, 64]} position={[position[0], position[1], positionZ]}>
          <meshBasicMaterial color={color} />
        </Circle>
      ) : (
        <group position={position}>
          <mesh
            position={[0, 0, positionZ]}
            scale={[0.5, 0.5, 0.5]}
            onPointerOver={debouncedHandlePointerOver}
            onPointerOut={debouncedHandlePointerOut}
          >
            {isHovered && (
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
                  {text}
                </div>
              </Html>
            )}
            <boxGeometry args={[1.3, 1.3, 1.3]} />
            <meshStandardMaterial color={color} opacity={0.6} transparent />
          </mesh>
        </group>
      )}
    </>
  );
};
