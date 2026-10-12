import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { radii } from '../theme/appTheme';
import { TeleopJoystick, useRobotTeleop } from './teleopControls';

export interface RobotTeleopDialogProps {
  robotId: string;
  robotName: string;
  open: boolean;
  onClose: () => void;
  /** When true, stick is disabled (e.g. offline). */
  disabled?: boolean;
}

/**
 * Modal drive pad (Devices). Prefer MapRobotDriveDock on the live map.
 */
export function RobotTeleopDialog({
  robotId,
  robotName,
  open,
  onClose,
  disabled = false,
}: RobotTeleopDialogProps): ReactElement {
  const { cmd, onJoystick, stop } = useRobotTeleop(robotId, open && !disabled);

  const handleClose = (): void => {
    stop();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: `${radii.dialog}px` } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SportsEsportsIcon color="primary" />
        Drive {robotName}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} alignItems="center" sx={{ pt: 1 }}>
          <Alert severity="warning" sx={{ width: '100%' }}>
            Hold the stick to drive. Release to stop. Fleet teleop overrides Nav2
            while active — cancel tasks first if the robot is on a mission.
          </Alert>
          {disabled && (
            <Alert severity="error" sx={{ width: '100%' }}>
              Robot is offline or not ready for teleop.
            </Alert>
          )}
          <TeleopJoystick disabled={disabled} onMove={onJoystick} />
          <Typography variant="caption" color="text.secondary">
            ↑ forward · ↓ reverse · ←→ turn ·{' '}
            {cmd.linear.toFixed(2)} m/s · {cmd.angular.toFixed(2)} rad/s
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="error" onClick={stop}>
          Stop
        </Button>
        <Button variant="contained" onClick={handleClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
