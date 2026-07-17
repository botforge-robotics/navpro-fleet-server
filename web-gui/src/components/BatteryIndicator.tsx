import BatteryAlertIcon from '@mui/icons-material/BatteryAlert';
import BatteryChargingFullIcon from '@mui/icons-material/BatteryChargingFull';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { radii } from '../theme/appTheme';

interface BatteryIndicatorProps {
  percent: number | null;
  charging?: boolean;
}

const LOW_BATTERY_THRESHOLD = 20;

export function BatteryIndicator({
  percent,
  charging = false,
}: BatteryIndicatorProps): ReactElement {
  if (percent === null) {
    return (
      <Typography variant="caption" color="text.disabled">
        battery unknown
      </Typography>
    );
  }

  const low = percent <= LOW_BATTERY_THRESHOLD;
  const icon = charging ? (
    <BatteryChargingFullIcon color="success" fontSize="small" />
  ) : low ? (
    <BatteryAlertIcon color="error" fontSize="small" />
  ) : (
    <BatteryFullIcon color="success" fontSize="small" />
  );

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
      {icon}
      <LinearProgress
        variant="determinate"
        value={Math.max(0, Math.min(100, percent))}
        color={low ? 'error' : 'success'}
        sx={{
          flexGrow: 1,
          height: 6,
          borderRadius: `${radii.pill}px`,
        }}
      />
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, minWidth: '2.75rem', textAlign: 'right', letterSpacing: '0.01em' }}
      >
        {Math.round(percent)}%
      </Typography>
    </Box>
  );
}
