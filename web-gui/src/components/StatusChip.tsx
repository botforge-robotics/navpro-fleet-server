import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import WarningIcon from '@mui/icons-material/Warning';
import Chip from '@mui/material/Chip';
import { alpha, useTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { radii } from '../theme/appTheme';

export type StatusTone = 'success' | 'error' | 'warning' | 'info' | 'neutral';

interface StatusChipProps {
  label: string;
  tone: StatusTone;
  size?: 'small' | 'medium';
}

// Operator-floor rule: status via icon + text, never color alone.
const toneIcon: Record<StatusTone, ReactElement> = {
  success: <CheckCircleIcon />,
  error: <CancelIcon />,
  warning: <WarningIcon />,
  info: <PlayCircleIcon />,
  neutral: <HourglassEmptyIcon />,
};

export function StatusChip({
  label,
  tone,
  size = 'small',
}: StatusChipProps): ReactElement {
  const theme = useTheme();
  const paletteKey =
    tone === 'neutral' ? null : (tone as 'success' | 'error' | 'warning' | 'info');
  const accent =
    paletteKey === null ? theme.palette.text.secondary : theme.palette[paletteKey].main;

  return (
    <Chip
      icon={toneIcon[tone] ?? <ErrorIcon />}
      label={label}
      size={size}
      variant="outlined"
      sx={{
        color: accent,
        borderColor: alpha(accent, 0.38),
        backgroundColor: alpha(accent, 0.1),
        fontWeight: 600,
        letterSpacing: '0.01em',
        borderRadius: `${radii.control}px`,
        '& .MuiChip-icon': { color: accent },
      }}
    />
  );
}

export function unknownStatusChip(label: string): ReactElement {
  return (
    <Chip
      icon={<HelpOutlineIcon />}
      label={label}
      size="small"
      variant="outlined"
      sx={(theme) => ({
        color: theme.palette.text.secondary,
        borderColor: theme.palette.divider,
        backgroundColor: alpha(theme.palette.text.secondary, 0.06),
        borderRadius: `${radii.control}px`,
      })}
    />
  );
}
