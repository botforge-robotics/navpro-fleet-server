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
import type { Fleet, Level, Robot } from '../../api/types';

interface RobotEditDialogProps {
  robot: Robot;
  fleets: Fleet[];
  levels: Level[];
  onClose: (changed: boolean) => void;
}

/** Assign fleet/level/charger/home and rename. PATCH /api/v1/robots/:id. */
export function RobotEditDialog({
  robot,
  fleets,
  levels,
  onClose,
}: RobotEditDialogProps): ReactElement {
  const [name, setName] = useState(robot.name);
  const [fleetId, setFleetId] = useState(robot.fleetId ?? '');
  const [levelId, setLevelId] = useState(robot.levelId ?? '');
  const [dockWaypoint, setDockWaypoint] = useState(robot.dockWaypoint ?? '');
  const [homeWaypoint, setHomeWaypoint] = useState(robot.homeWaypoint ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/v1/robots/${robot.id}`, {
        name,
        fleetId: fleetId === '' ? null : fleetId,
        levelId: levelId === '' ? null : levelId,
        dockWaypoint: dockWaypoint || null,
        homeWaypoint: homeWaypoint || null,
      });
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => onClose(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Edit {robot.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Fleet"
            select
            value={fleetId}
            onChange={(e) => setFleetId(e.target.value)}
          >
            <MenuItem value="">Unassigned</MenuItem>
            {fleets.map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Level"
            select
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
          >
            <MenuItem value="">Unassigned</MenuItem>
            {levels.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Charger waypoint"
            value={dockWaypoint}
            onChange={(e) => setDockWaypoint(e.target.value)}
          />
          <TextField
            label="Home waypoint"
            value={homeWaypoint}
            onChange={(e) => setHomeWaypoint(e.target.value)}
          />
          {error !== null && (
            <TextField value={error} label="Error" error disabled multiline />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button onClick={save} variant="contained" disabled={busy}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
