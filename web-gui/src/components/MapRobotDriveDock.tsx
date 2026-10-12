import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Robot } from '../api/types';
import { useFleetLiveState } from '../hooks/useFleetLiveState';
import { radii } from '../theme/appTheme';
import { TeleopJoystick, useRobotTeleop } from './teleopControls';

export interface MapRobotDriveDockProps {
  /** RMF / display name from map click. */
  robotName: string;
  fleet?: string;
  /** Live RMF pose from the map [x, y, yaw, mapName]. */
  location?: [number, number, number, string] | null;
  onClose: () => void;
}

/**
 * Non-modal drive pad docked on the map — map stays visible behind it.
 */
export function MapRobotDriveDock({
  robotName,
  location = null,
  onClose,
}: MapRobotDriveDockProps): ReactElement {
  const { robots } = useFleetLiveState();
  const live = robots.find((r) => r.name === robotName && !r.retired);
  const [resolved, setResolved] = useState<Robot | null>(live ?? null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (live) {
      setResolved(live);
      setLookupError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<Robot[]>('/api/v1/robots');
        if (cancelled) return;
        const match = list.find((r) => r.name === robotName && !r.retired);
        if (!match) {
          setLookupError(`No platform robot named “${robotName}”.`);
          setResolved(null);
          return;
        }
        setResolved(match);
        setLookupError(null);
      } catch (err) {
        if (!cancelled) {
          setLookupError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, robotName]);

  useEffect(() => {
    if (live) setResolved(live);
  }, [live]);

  // Arm host USB joy only while this Drive pad is open (short TTL, refreshed).
  useEffect(() => {
    if (!resolved?.id) return;
    const robotId = resolved.id;
    const arm = (): void => {
      void api.put('/api/v1/joy-target', { robotId }).catch(() => undefined);
    };
    arm();
    const id = window.setInterval(arm, 3000);
    return () => {
      window.clearInterval(id);
      void api.delete('/api/v1/joy-target').catch(() => undefined);
    };
  }, [resolved?.id]);

  const robotId = resolved?.id ?? null;
  const offline = resolved?.mode === 'offline';
  const { cmd, onJoystick, stop } = useRobotTeleop(robotId, robotId !== null && !offline);

  const pose = resolved?.pose;
  const locLabel = location
    ? `x ${location[0].toFixed(2)} · y ${location[1].toFixed(2)} · ${(
        (location[2] * 180) /
        Math.PI
      ).toFixed(0)}°`
    : pose
      ? `x ${pose.x.toFixed(2)} · y ${pose.y.toFixed(2)} · ${(
          (pose.yaw * 180) /
          Math.PI
        ).toFixed(0)}°`
      : 'Waiting for pose…';

  const handleClose = (): void => {
    stop();
    void api.delete('/api/v1/joy-target').catch(() => undefined);
    onClose();
  };

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        zIndex: 20,
        width: 220,
        p: 1.5,
        borderRadius: `${radii.card}px`,
        pointerEvents: 'auto',
        bgcolor: 'background.paper',
        border: (theme) => `1px solid ${theme.palette.divider}`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Stack spacing={1.25} alignItems="stretch">
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.5}>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
            <SportsEsportsIcon color="primary" fontSize="small" />
            <Typography variant="subtitle2" noWrap fontWeight={700}>
              {robotName}
            </Typography>
          </Stack>
          <IconButton size="small" aria-label="Close drive" onClick={handleClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {locLabel}
        </Typography>

        {lookupError !== null && (
          <Alert severity="error" sx={{ py: 0 }}>
            {lookupError}
          </Alert>
        )}
        {offline && (
          <Alert severity="warning" sx={{ py: 0 }}>
            Offline
          </Alert>
        )}
        {!offline && resolved?.mode === 'navigating' && (
          <Alert severity="info" sx={{ py: 0 }}>
            Nav active — cancel task if stick fights Nav2
          </Alert>
        )}

        <TeleopJoystick disabled={!robotId || offline} onMove={onJoystick} size={132} />

        <Typography variant="caption" color="text.secondary" textAlign="center">
          {cmd.linear.toFixed(2)} m/s · {cmd.angular.toFixed(2)} rad/s
        </Typography>
        <Typography variant="caption" color="text.secondary" textAlign="center">
          USB: hold RB · only while this pad is open
        </Typography>

        <Stack direction="row" spacing={1}>
          <Button size="small" color="error" fullWidth onClick={stop}>
            Stop
          </Button>
          <Button size="small" variant="outlined" fullWidth onClick={handleClose}>
            Done
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
