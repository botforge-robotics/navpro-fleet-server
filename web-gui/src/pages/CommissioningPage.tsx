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
import type { Fleet, Level, Robot, RobotMode } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RobotTeleopDialog } from '../components/RobotTeleopDialog';
import { StatusChip, type StatusTone } from '../components/StatusChip';
import { useFetch } from '../hooks/useFetch';
import { useFleetLiveState } from '../hooks/useFleetLiveState';
import { RobotEditDialog } from './robots/RobotEditDialog';

function needsCommissioning(robot: Robot): boolean {
  if (robot.retired) return false;
  if (robot.status === 'unprovisioned') return true;
  if (robot.status !== 'active') return true;
  if (!robot.fleetId || !robot.levelId) return true;
  return false;
}

function modeTone(mode: RobotMode): StatusTone {
  if (mode === 'error' || mode === 'offline') return 'error';
  if (mode === 'navigating' || mode === 'docking') return 'info';
  if (mode === 'paused') return 'warning';
  return 'success';
}

function registryTone(status: string | undefined): StatusTone {
  if (status === 'active') return 'success';
  if (status === 'unprovisioned') return 'warning';
  if (status === 'retired' || status === 'maintenance') return 'neutral';
  return 'info';
}

function levelHasOccupancy(level: Level | undefined): boolean {
  if (!level) return false;
  if (typeof level.imageUrl === 'string' && level.imageUrl.length > 0) return true;
  const path = (level as Level & { occupancyMapPath?: string | null }).occupancyMapPath;
  return typeof path === 'string' && path.length > 0;
}

interface DecommissionResult {
  deleted: boolean;
  factoryResetQueued: boolean;
  message: string;
}

/**
 * Pending robots from captive-portal register.
 * Commission = activate onto fleet + default floor.
 * Per-robot level / parking / Start Nav are set afterward via Edit.
 */
export function CommissioningSection(): ReactElement {
  const { robots, wsConnected } = useFleetLiveState();
  const { data: fleets } = useFetch<Fleet[]>('/api/v1/fleets');
  const { data: levels } = useFetch<Level[]>('/api/v1/levels');

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [decommissionRobot, setDecommissionRobot] = useState<Robot | null>(null);
  const [editRobot, setEditRobot] = useState<Robot | null>(null);
  const [teleopRobot, setTeleopRobot] = useState<Robot | null>(null);

  const pending = useMemo(() => robots.filter(needsCommissioning), [robots]);
  const active = useMemo(
    () => robots.filter((r) => !needsCommissioning(r) && !r.retired),
    [robots],
  );

  const preferredLevel = useMemo(() => {
    const levelList = levels ?? [];
    return levelList.find((l) => l.name === 'L1') ?? levelList[0];
  }, [levels]);

  const mapReady = levelHasOccupancy(preferredLevel);

  const levelName = (id: string | null | undefined): string => {
    if (!id) return '—';
    return levels?.find((l) => l.id === id)?.name ?? id.slice(0, 8);
  };

  const commission = async (robot: Robot): Promise<void> => {
    const fleetList = fleets ?? [];
    const preferredFleet =
      fleetList.find((f) => f.name === 'navpromini') ??
      fleetList.find((f) => f.name === 'navpro') ??
      fleetList[0];
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
      const parking = robot.homeWaypoint || robot.dockWaypoint || undefined;
      // Map ready + parking known → activate and auto start nav (plan Path A).
      // No map → claim onto fleet/level only (plan Path B); map first, then Edit + Nav ready.
      const startNav = Boolean(mapReady && parking);
      await api.post(`/api/v1/robots/${robot.id}/activate`, {
        name: robot.name,
        fleetId,
        levelId,
        dockWaypoint: robot.dockWaypoint ?? undefined,
        homeWaypoint: robot.homeWaypoint ?? undefined,
        startNav,
      });
      if (!mapReady) {
        setActionMsg(
          `${robot.name}: claimed (no map yet — Mapping → parking → Edit → Nav ready).`,
        );
      } else if (startNav) {
        setActionMsg(`${robot.name}: commissioned + Nav ready queued at ${parking}.`);
      } else {
        setActionMsg(
          `${robot.name}: commissioned. Use Edit to set parking, then Nav ready.`,
        );
        setEditRobot({ ...robot, fleetId, levelId, status: 'active' });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const startNavNow = async (robot: Robot): Promise<void> => {
    if (!robot.homeWaypoint && !robot.dockWaypoint) {
      setActionError(`Set home/parking for ${robot.name} via Edit first.`);
      return;
    }
    setBusyId(robot.id);
    setActionError(null);
    try {
      await api.post(`/api/v1/robots/${robot.id}/nav`, {
        action: 'start',
        parkingWaypoint: robot.homeWaypoint || robot.dockWaypoint || undefined,
      });
      setActionMsg(`${robot.name}: start nav queued.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const setInitialPose = async (robot: Robot): Promise<void> => {
    if (!robot.homeWaypoint && !robot.dockWaypoint) {
      setActionError(`Set home/parking for ${robot.name} via Edit first.`);
      return;
    }
    setBusyId(robot.id);
    setActionError(null);
    setActionMsg(null);
    try {
      const res = await api.post<{
        ok?: boolean;
        pose?: { x: number; y: number; yaw: number };
        parkingWaypoint?: string | null;
      }>(`/api/v1/robots/${robot.id}/nav`, {
        action: 'set_pose',
        parkingWaypoint: robot.homeWaypoint || robot.dockWaypoint || undefined,
      });
      const pose = res.pose;
      const spot = res.parkingWaypoint ?? robot.homeWaypoint ?? robot.dockWaypoint;
      setActionMsg(
        pose
          ? `${robot.name}: initial pose @ ${spot} (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)})`
          : `${robot.name}: set initial pose queued.`,
      );
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
        {},
      );
      setActionMsg(result.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Robot commissioning
        </Typography>
        <StatusChip
          label={wsConnected ? 'Live' : 'Polling'}
          tone={wsConnected ? 'success' : 'warning'}
        />
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>
        Robots join via hotspot (<code>NavPro-Setup-&lt;MAC&gt;</code>, password{' '}
        <code>navprosetup</code> → <code>http://10.42.0.1/</code>).{' '}
        {mapReady ? (
          <>
            Site has a map — <strong>Commission</strong> activates onto the fleet. Then{' '}
            <strong>Edit</strong> (level + parking), <strong>Nav ready</strong>, then assign tasks.
          </>
        ) : (
          <>
            No occupancy yet — use <strong>Claim</strong> to register the name only, then map under{' '}
            <strong>Building → Mapping</strong>, add parking, and commission for nav.
          </>
        )}
      </Alert>
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {actionMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setActionMsg(null)}>
          {actionMsg}
        </Alert>
      )}

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Pending{' '}
        <Badge badgeContent={pending.length} color="warning">
          <span />
        </Badge>
      </Typography>
      <TableContainer component={Paper} sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Serial</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pending.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>No pending robots</TableCell>
              </TableRow>
            )}
            {pending.map((robot) => (
              <TableRow key={robot.id}>
                <TableCell>{robot.name}</TableCell>
                <TableCell>{robot.serial}</TableCell>
                <TableCell>
                  <StatusChip
                    label={robot.status ?? 'pending'}
                    tone={registryTone(robot.status)}
                  />
                </TableCell>
                <TableCell>
                  <StatusChip label={robot.mode} tone={modeTone(robot.mode)} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busyId === robot.id}
                    onClick={() => void commission(robot)}
                  >
                    {busyId === robot.id ? (
                      <CircularProgress size={18} />
                    ) : mapReady ? (
                      'Commission'
                    ) : (
                      'Claim'
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Active
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell>Nav</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>Home</TableCell>
              <TableCell>Dock</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {active.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>No active robots</TableCell>
              </TableRow>
            )}
            {active.map((robot) => (
              <TableRow key={robot.id}>
                <TableCell>{robot.name}</TableCell>
                <TableCell>
                  <StatusChip label={robot.mode} tone={modeTone(robot.mode)} />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                    {robot.health?.navMode ? (
                      <StatusChip
                        label={robot.health.navMode}
                        tone={
                          robot.health.readyForTasks
                            ? 'success'
                            : robot.health.navMode === 'MAPPING'
                              ? 'info'
                              : 'warning'
                        }
                      />
                    ) : (
                      <StatusChip label="—" tone="neutral" />
                    )}
                    {robot.health?.readyForTasks === true && (
                      <StatusChip label="task-ready" tone="success" />
                    )}
                  </Stack>
                </TableCell>
                <TableCell>{levelName(robot.levelId)}</TableCell>
                <TableCell>{robot.homeWaypoint ?? '—'}</TableCell>
                <TableCell>{robot.dockWaypoint ?? '—'}</TableCell>
                <TableCell align="right">
                  <Button size="small" sx={{ mr: 1 }} onClick={() => setEditRobot(robot)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    sx={{ mr: 1 }}
                    color="primary"
                    disabled={robot.mode === 'offline'}
                    onClick={() => setTeleopRobot(robot)}
                  >
                    Drive
                  </Button>
                  <Button
                    size="small"
                    sx={{ mr: 1 }}
                    disabled={
                      busyId === robot.id ||
                      !mapReady ||
                      !(robot.homeWaypoint || robot.dockWaypoint)
                    }
                    onClick={() => void startNavNow(robot)}
                  >
                    Nav ready
                  </Button>
                  <Button
                    size="small"
                    sx={{ mr: 1 }}
                    disabled={
                      busyId === robot.id ||
                      !(robot.homeWaypoint || robot.dockWaypoint)
                    }
                    onClick={() => void setInitialPose(robot)}
                  >
                    Set initial pose
                  </Button>
                  <Button
                    size="small"
                    color="warning"
                    onClick={() => setDecommissionRobot(robot)}
                  >
                    Decommission
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {editRobot !== null && (
        <RobotEditDialog
          robot={editRobot}
          fleets={fleets ?? []}
          levels={levels ?? []}
          onClose={() => setEditRobot(null)}
        />
      )}

      {teleopRobot !== null && (
        <RobotTeleopDialog
          robotId={teleopRobot.id}
          robotName={teleopRobot.name}
          open
          disabled={teleopRobot.mode === 'offline'}
          onClose={() => setTeleopRobot(null)}
        />
      )}

      <ConfirmDialog
        open={decommissionRobot !== null}
        title="Decommission robot"
        message={
          decommissionRobot?.mode === 'offline'
            ? `Remove ${decommissionRobot?.name ?? ''} from the fleet database? The robot is offline — it will not factory-reset automatically.`
            : `Remove ${decommissionRobot?.name ?? ''} from the fleet database? The robot is online and will factory-reset.`
        }
        confirmLabel="Decommission"
        onConfirm={() => void confirmDecommission()}
        onCancel={() => setDecommissionRobot(null)}
      />
    </Box>
  );
}
