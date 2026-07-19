import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Fleet, Level, Robot } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusChip } from '../components/StatusChip';
import { useFetch } from '../hooks/useFetch';

function needsCommissioning(robot: Robot): boolean {
  if (robot.retired) return false;
  if (robot.status === 'unprovisioned') return true;
  if (robot.status !== 'active') return true;
  if (!robot.fleetId || !robot.levelId) return true;
  return false;
}

interface DecommissionResult {
  deleted: boolean;
  factoryResetQueued: boolean;
  message: string;
}

/**
 * Pending robots from captive-portal register → one-click Commission (Activate)
 * using fleet navpromini + floor L1. Decommission deletes from the DB and
 * factory-resets the Pi when it is online.
 */
export function CommissioningSection(): ReactElement {
  const { data: robots, error, reload } = useFetch<Robot[]>('/api/v1/robots');
  const { data: fleets } = useFetch<Fleet[]>('/api/v1/fleets');
  const { data: levels } = useFetch<Level[]>('/api/v1/levels');

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [decommissionRobot, setDecommissionRobot] = useState<Robot | null>(null);

  const pending = useMemo(() => (robots ?? []).filter(needsCommissioning), [robots]);
  const active = useMemo(
    () => (robots ?? []).filter((r) => !needsCommissioning(r) && !r.retired),
    [robots],
  );

  const commission = async (robot: Robot): Promise<void> => {
    const fleetList = fleets ?? [];
    const levelList = levels ?? [];
    const preferredFleet =
      fleetList.find((f) => f.name === 'navpromini') ??
      fleetList.find((f) => f.name === 'navpro') ??
      fleetList[0];
    const preferredLevel =
      levelList.find((l) => l.name === 'L1') ?? levelList[0];
    const fleetId = robot.fleetId ?? preferredFleet?.id;
    const levelId = robot.levelId ?? preferredLevel?.id;
    if (!fleetId || !levelId) {
      setActionError(
        'Default fleet/floor missing — wait a few seconds and refresh (server seeds navpromini + L1 on startup).',
      );
      return;
    }
    setBusyId(robot.id);
    setActionError(null);
    setActionMsg(null);
    try {
      await api.post(`/api/v1/robots/${robot.id}/activate`, {
        name: robot.name,
        fleetId,
        levelId,
      });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDecommission = async (): Promise<void> => {
    if (decommissionRobot === null) return;
    const robot = decommissionRobot;
    setDecommissionRobot(null);
    setBusyId(robot.id);
    setActionError(null);
    setActionMsg(null);
    try {
      const result = await api.post<DecommissionResult>(
        `/api/v1/robots/${robot.id}/decommission`,
      );
      setActionMsg(result.message);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Robot commissioning
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Click <strong>Commission</strong> to activate with fleet <strong>navpromini</strong> and
        floor <strong>L1</strong> (created automatically). Map / charger can come later.{' '}
        <strong>Decommission</strong> deletes the robot from the fleet server; if it is online it
        factory-resets back to the setup hotspot.
      </Typography>
      {error !== null && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {actionError !== null && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {actionMsg !== null && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={() => setActionMsg(null)}>
          {actionMsg}
        </Alert>
      )}
      <Alert severity="info" sx={{ mb: 2 }}>
        First power-on: join <strong>NavPro-Setup-XXXX</strong> → <code>http://10.42.0.1/</code> →
        Wi‑Fi, robot name, server IP, token. Then click Commission here.
      </Alert>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Badge badgeContent={pending.length} color="warning">
          <Typography variant="h6">Pending</Typography>
        </Badge>
        <Typography variant="body2" color="text.secondary">
          {active.length} active on fleet
          {fleets?.[0] ? ` · default fleet: ${fleets[0].name}` : ''}
          {levels?.[0] ? ` · floor: ${levels[0].name}` : ''}
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
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busyId !== null}
                      onClick={() => void commission(robot)}
                      startIcon={
                        busyId === robot.id ? (
                          <CircularProgress size={14} color="inherit" />
                        ) : undefined
                      }
                    >
                      Commission
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      disabled={busyId !== null}
                      onClick={() => setDecommissionRobot(robot)}
                    >
                      Decommission
                    </Button>
                  </Stack>
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
              <TableCell align="right">Action</TableCell>
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
                  <StatusChip
                    label={robot.mode}
                    tone={robot.mode === 'offline' ? 'error' : 'success'}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    disabled={busyId !== null}
                    onClick={() => setDecommissionRobot(robot)}
                    startIcon={
                      busyId === robot.id ? (
                        <CircularProgress size={14} color="inherit" />
                      ) : undefined
                    }
                  >
                    Decommission
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDialog
        open={decommissionRobot !== null}
        title="Decommission robot"
        message={
          decommissionRobot?.mode === 'offline'
            ? `Remove ${decommissionRobot?.name ?? ''} from the fleet database? The robot is offline — it will not factory-reset automatically (wipe the Pi manually if you reuse it).`
            : `Remove ${decommissionRobot?.name ?? ''} from the fleet database? The robot is online and will factory-reset (forget Wi‑Fi, reboot into NavPro-Setup hotspot).`
        }
        confirmLabel="Decommission"
        destructive
        onConfirm={() => void confirmDecommission()}
        onCancel={() => setDecommissionRobot(null)}
      />
    </Box>
  );
}
