import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Fleet, Level, Robot } from '../api/types';
import { StatusChip } from '../components/StatusChip';
import { useFetch } from '../hooks/useFetch';

function needsCommissioning(robot: Robot): boolean {
  if (robot.retired) return false;
  if (robot.status === 'unprovisioned') return true;
  if (robot.status !== 'active') return true;
  if (!robot.fleetId || !robot.levelId) return true;
  if (!robot.dockWaypoint) return true;
  return false;
}

interface ActivateDialogProps {
  robot: Robot;
  fleets: Fleet[];
  levels: Level[];
  chargerNames: string[];
  onClose: (changed: boolean) => void;
}

function ActivateDialog({
  robot,
  fleets,
  levels,
  chargerNames,
  onClose,
}: ActivateDialogProps): ReactElement {
  const [name, setName] = useState(robot.name);
  const [fleetId, setFleetId] = useState(robot.fleetId ?? fleets[0]?.id ?? '');
  const [levelId, setLevelId] = useState(robot.levelId ?? levels[0]?.id ?? '');
  const [dockWaypoint, setDockWaypoint] = useState(robot.dockWaypoint ?? chargerNames[0] ?? '');
  const [homeWaypoint, setHomeWaypoint] = useState(robot.homeWaypoint ?? chargerNames[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/robots/${robot.id}/activate`, {
        name,
        fleetId,
        levelId,
        dockWaypoint,
        homeWaypoint: homeWaypoint || undefined,
      });
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => onClose(false)} maxWidth="sm" fullWidth>
      <DialogTitle>Activate {robot.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Serial {robot.serial}. After Activate, the fleet adapter adds this robot to the live
            map within ~5s.
          </Typography>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Fleet"
            select
            value={fleetId}
            onChange={(e) => setFleetId(e.target.value)}
          >
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
            {levels.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Charger waypoint"
            select
            value={dockWaypoint}
            onChange={(e) => setDockWaypoint(e.target.value)}
            helperText="Named charger vertex from the building graph"
          >
            {chargerNames.length === 0 && (
              <MenuItem value={dockWaypoint || 'charger'}>{dockWaypoint || 'charger'}</MenuItem>
            )}
            {chargerNames.map((n) => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
            {dockWaypoint && !chargerNames.includes(dockWaypoint) && (
              <MenuItem value={dockWaypoint}>{dockWaypoint}</MenuItem>
            )}
          </TextField>
          <TextField
            label="Home / parking waypoint"
            value={homeWaypoint}
            onChange={(e) => setHomeWaypoint(e.target.value)}
            helperText="Usually the same as charger, or a parking spot name"
          />
          {error !== null && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button
          onClick={() => void activate()}
          variant="contained"
          disabled={busy || !fleetId || !levelId || !dockWaypoint}
        >
          Activate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Pending robots from captive-portal register → assign fleet/level/charger → Activate into RMF.
 * Embedded under the Devices tab (not a standalone route).
 */
export function CommissioningSection(): ReactElement {
  const { data: robots, error, reload } = useFetch<Robot[]>('/api/v1/robots');
  const { data: fleets } = useFetch<Fleet[]>('/api/v1/fleets');
  const { data: levels } = useFetch<Level[]>('/api/v1/levels');
  const { data: buildings } = useFetch<Array<{ id: string; name: string; graph?: { waypoints?: Array<{ name: string; isCharger?: boolean }> } }>>('/api/v1/buildings');

  const [selected, setSelected] = useState<Robot | null>(null);

  const pending = useMemo(() => (robots ?? []).filter(needsCommissioning), [robots]);
  const active = useMemo(
    () => (robots ?? []).filter((r) => !needsCommissioning(r) && !r.retired),
    [robots],
  );

  const chargerNames = useMemo(() => {
    const names = new Set<string>();
    for (const b of buildings ?? []) {
      for (const w of b.graph?.waypoints ?? []) {
        if (w.isCharger && w.name) names.add(w.name);
      }
    }
    return [...names].sort();
  }, [buildings]);

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Robot commissioning
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Robots appear here after hotspot Wi-Fi setup. Activate to place them on the RMF map.
      </Typography>
      {error !== null && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      <Alert severity="info" sx={{ mb: 2 }}>
        First power-on: join the robot hotspot <strong>NavPro-Setup-XXXX</strong>, open{' '}
        <code>http://10.42.0.1/</code>, enter site Wi‑Fi, robot name, server IP, and provisioning
        token. Fleet and floor are chosen here when you Commission (robots can move between floors).
      </Alert>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Badge badgeContent={pending.length} color="warning">
          <Typography variant="h6">Pending</Typography>
        </Badge>
        <Typography variant="body2" color="text.secondary">
          {active.length} active on fleet
        </Typography>
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Serial</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last seen</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pending.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    No pending robots. Power on the next robot and complete its hotspot form.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {pending.map((robot) => (
              <TableRow key={robot.id} hover>
                <TableCell>{robot.name}</TableCell>
                <TableCell>{robot.serial}</TableCell>
                <TableCell>
                  <StatusChip label={robot.status ?? 'pending'} tone="warning" />
                </TableCell>
                <TableCell>{robot.lastSeen ?? '—'}</TableCell>
                <TableCell align="right">
                  <Button size="small" variant="contained" onClick={() => setSelected(robot)}>
                    Commission
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Active robots
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Serial</TableCell>
              <TableCell>Charger</TableCell>
              <TableCell>Home</TableCell>
              <TableCell>Mode</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {active.map((robot) => (
              <TableRow key={robot.id}>
                <TableCell>{robot.name}</TableCell>
                <TableCell>{robot.serial}</TableCell>
                <TableCell>{robot.dockWaypoint ?? '—'}</TableCell>
                <TableCell>{robot.homeWaypoint ?? '—'}</TableCell>
                <TableCell>
                  <StatusChip label={robot.mode} tone="success" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {selected !== null && (
        <ActivateDialog
          robot={selected}
          fleets={fleets ?? []}
          levels={levels ?? []}
          chargerNames={chargerNames}
          onClose={(changed) => {
            setSelected(null);
            if (changed) reload();
          }}
        />
      )}
    </Box>
  );
}
