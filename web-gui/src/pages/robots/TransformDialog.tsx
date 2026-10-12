import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Level, LevelTransform, Robot } from '../../api/types';

interface TransformDialogProps {
  robot: Robot;
  levels: Level[];
  onClose: (changed: boolean) => void;
}

/**
 * Edit the per-level transform (x, y, yaw, scale) mapping the robot's SLAM
 * map into building coordinates. PUT /api/v1/robots/:id/transforms/:levelId.
 */
export function TransformDialog({
  robot,
  levels,
  onClose,
}: TransformDialogProps): ReactElement {
  const [levelId, setLevelId] = useState(
    robot.levelId ?? levels[0]?.id ?? '',
  );
  const existing = robot.transforms.find((t) => t.levelId === levelId);
  const [x, setX] = useState(String(existing?.x ?? 0));
  const [y, setY] = useState(String(existing?.y ?? 0));
  const [yaw, setYaw] = useState(String(existing?.yaw ?? 0));
  const [scale, setScale] = useState(String(existing?.scale ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectLevel = (id: string): void => {
    setLevelId(id);
    const t: LevelTransform | undefined = robot.transforms.find(
      (tr) => tr.levelId === id,
    );
    setX(String(t?.x ?? 0));
    setY(String(t?.y ?? 0));
    setYaw(String(t?.yaw ?? 0));
    setScale(String(t?.scale ?? 1));
  };

  const save = async (): Promise<void> => {
    const parsed = {
      x: Number(x),
      y: Number(y),
      yaw: Number(yaw),
      scale: Number(scale),
    };
    if (Object.values(parsed).some((v) => Number.isNaN(v))) {
      setError('All transform fields must be numeric.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/v1/robots/${robot.id}/transforms/${levelId}`, parsed);
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => onClose(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Map transform - {robot.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Level"
            select
            value={levelId}
            onChange={(e) => selectLevel(e.target.value)}
          >
            {levels.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="X (m)" value={x} onChange={(e) => setX(e.target.value)} />
          <TextField label="Y (m)" value={y} onChange={(e) => setY(e.target.value)} />
          <TextField
            label="Yaw (rad)"
            value={yaw}
            onChange={(e) => setYaw(e.target.value)}
          />
          <TextField
            label="Scale"
            value={scale}
            onChange={(e) => setScale(e.target.value)}
          />
          {error !== null && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button onClick={save} variant="contained" disabled={busy || levelId === ''}>
          Save transform
        </Button>
      </DialogActions>
    </Dialog>
  );
}
