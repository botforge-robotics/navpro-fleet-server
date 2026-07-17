import { useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Html } from '@react-three/drei';
import React from 'react';

interface TextThreeRenderingProps {
  position: [number, number, number];
  text?: string;
}

export const TextThreeRendering = ({ position, text }: TextThreeRenderingProps): JSX.Element => {
  const theme = useTheme();
  const HEIGHT = 8;
  const ELEVATION = 0;
  const positionZ = HEIGHT / 2 + ELEVATION;
  const [isHovered, setIsHovered] = React.useState(false);

  const handlePointerOver = () => {
    setIsHovered(true);
  };

  const handlePointerOut = () => {
    setIsHovered(false);
  };

  const scaleFactor = isHovered ? 2 : 1.0;
  return (
    <>
      <mesh position={position}>
        <mesh position={[0, 0, positionZ]}>
          {text && (
            <Html zIndexRange={[0, 0, 1]}>
              {text && (
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
                  onPointerOver={handlePointerOver}
                  onPointerOut={handlePointerOut}
                >
                  {text}
                </div>
              )}
            </Html>
          )}
        </mesh>
      </mesh>
    </>
  );
};

export default TextThreeRendering;
