import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';

interface HealthSparklineProps {
  label: string;
  values: Array<number | null>;
  unit: string;
}

const WIDTH = 280;
const HEIGHT = 48;

/** Minimal dependency-free SVG sparkline; colors come from the theme. */
export function HealthSparkline({ label, values, unit }: HealthSparklineProps): ReactElement {
  const theme = useTheme();
  const points = values.filter((v): v is number => v !== null);

  if (points.length < 2) {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">
          {label}: not enough data
        </Typography>
      </Box>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = WIDTH / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = HEIGHT - ((v - min) / range) * HEIGHT;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const latest = points[points.length - 1];

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}: {latest?.toFixed(1)} {unit} (min {min.toFixed(1)}, max {max.toFixed(1)})
      </Typography>
      <svg width={WIDTH} height={HEIGHT} role="img" aria-label={label}>
        <path
          d={path}
          fill="none"
          stroke={theme.palette.primary.light}
          strokeWidth={2}
        />
      </svg>
    </Box>
  );
}
