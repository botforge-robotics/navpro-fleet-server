import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import EditIcon from '@mui/icons-material/Edit';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import TransformIcon from '@mui/icons-material/Transform';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../api/client';
import type { Fleet, Level, Robot } from '../api/types';
import { BatteryIndicator } from '../components/BatteryIndicator';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { useFetch } from '../hooks/useFetch';
import { RobotDetailDrawer } from './robots/RobotDetailDrawer';
import { RobotEditDialog } from './robots/RobotEditDialog';
import { TransformDialog } from './robots/TransformDialog';

interface DecommissionResult {
  deleted: boolean;
  factoryResetQueued: boolean;
  message: string;
}

export function RobotsPage(): ReactElement {
  const { data: robots, error, reload } = useFetch<Robot[]>('/api/v1/robots');
  const { data: fleets } = useFetch<Fleet[]>('/api/v1/fleets');
  const { data: levels } = useFetch<Level[]>('/api/v1/levels');

  const [detailRobot, setDetailRobot] = useState<Robot | null>(null);
  const [editRobot, setEditRobot] = useState<Robot | null>(null);
  const [transformRobot, setTransformRobot] = useState<Robot | null>(null);
  const [retireRobot, setRetireRobot] = useState<Robot | null>(null);
  const [decommissionRobot, setDecommissionRobot] = useState<Robot | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fleetName = (id: string | null): string =>
    fleets?.find((f) => f.id === id)?.name ?? 'unassigned';
  const levelName = (id: string | null): string =>
    levels?.find((l) => l.id === id)?.name ?? '-';

  const confirmRetire = async (): Promise<void> => {
    if (retireRobot === null) return;
    await api.post(`/api/v1/robots/${retireRobot.id}/retire`);
    setRetireRobot(null);
    reload();
  };

  const confirmDecommission = async (): Promise<void> => {
    if (decommissionRobot === null) return;
    const robot = decommissionRobot;
    setDecommissionRobot(null);
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
    }
  };

  return (
    <Box>
      <PageHeader
        title="Robots"
        subtitle="Registry is the source of truth; RMF config is generated from it"
      />
      {error !== null && <Alert severity="error">{error}</Alert>}
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
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Serial</TableCell>
              <TableCell>Fleet</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell sx={{ minWidth: 160 }}>Battery</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(robots ?? []).map((robot) => (
              <TableRow
                key={robot.id}
                hover
                onClick={() => setDetailRobot(robot)}
                sx={{ cursor: 'pointer', opacity: robot.retired ? 0.5 : 1 }}
              >
                <TableCell>{robot.name}</TableCell>
                <TableCell>{robot.serial}</TableCell>
                <TableCell>{fleetName(robot.fleetId)}</TableCell>
                <TableCell>{levelName(robot.levelId)}</TableCell>
                <TableCell>
                  <StatusChip
                    label={robot.retired ? 'retired' : robot.mode}
                    tone={
                      robot.retired
                        ? 'neutral'
                        : robot.mode === 'error' || robot.mode === 'offline'
                          ? 'error'
                          : robot.mode === 'navigating'
                            ? 'info'
                            : 'success'
                    }
                  />
                </TableCell>
                <TableCell>
                  <BatteryIndicator percent={robot.batteryPercent} />
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Assign fleet / level">
                    <IconButton onClick={() => setEditRobot(robot)} size="small">
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Edit map transform">
                    <IconButton onClick={() => setTransformRobot(robot)} size="small">
                      <TransformIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Retire (keep history)">
                    <IconButton
                      onClick={() => setRetireRobot(robot)}
                      size="small"
                      disabled={robot.retired}
                    >
                      <PersonOffIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Decommission (delete + factory reset if online)">
                    <IconButton
                      onClick={() => setDecommissionRobot(robot)}
                      size="small"
                      color="error"
                    >
                      <DeleteForeverIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {detailRobot !== null && (
        <RobotDetailDrawer robot={detailRobot} onClose={() => setDetailRobot(null)} />
      )}
      {editRobot !== null && (
        <RobotEditDialog
          robot={editRobot}
          fleets={fleets ?? []}
          levels={levels ?? []}
          onClose={(changed) => {
            setEditRobot(null);
            if (changed) reload();
          }}
        />
      )}
      {transformRobot !== null && (
        <TransformDialog
          robot={transformRobot}
          levels={levels ?? []}
          onClose={(changed) => {
            setTransformRobot(null);
            if (changed) reload();
          }}
        />
      )}
      <ConfirmDialog
        open={retireRobot !== null}
        title="Retire robot"
        message={`Retire ${retireRobot?.name ?? ''}? It stops receiving tasks but its history is kept.`}
        confirmLabel="Retire"
        destructive
        onConfirm={() => void confirmRetire()}
        onCancel={() => setRetireRobot(null)}
      />
      <ConfirmDialog
        open={decommissionRobot !== null}
        title="Decommission robot"
        message={
          decommissionRobot?.mode === 'offline'
            ? `Delete ${decommissionRobot?.name ?? ''} from the fleet database? Offline — no automatic factory reset.`
            : `Delete ${decommissionRobot?.name ?? ''} from the fleet database? Online — the robot will factory-reset into the setup hotspot.`
        }
        confirmLabel="Decommission"
        destructive
        onConfirm={() => void confirmDecommission()}
        onCancel={() => setDecommissionRobot(null)}
      />
    </Box>
  );
}
