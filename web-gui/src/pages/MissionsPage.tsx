import RefreshIcon from '@mui/icons-material/Refresh';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { Mission, MissionStatus } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { StatusChip, type StatusTone } from '../components/StatusChip';
import { useFetch } from '../hooks/useFetch';
import { MissionDetail } from './missions/MissionDetail';

const statusTone: Record<MissionStatus, StatusTone> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
  needs_operator: 'warning',
};

export function MissionsPage(): ReactElement {
  const { data: missions, error, reload } = useFetch<Mission[]>('/api/v1/missions');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = missions?.find((m) => m.id === selectedId) ?? null;

  return (
    <Box>
      <PageHeader
        title="Missions"
        subtitle="Compiled workflow runs with saga step states"
        actions={
          <IconButton onClick={reload} aria-label="refresh">
            <RefreshIcon />
          </IconButton>
        }
      />
      {error !== null && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Mission</TableCell>
                  <TableCell>Workflow</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Updated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(missions ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ py: 4, textAlign: 'center' }}
                      >
                        No missions yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {(missions ?? []).map((mission) => (
                  <TableRow
                    key={mission.id}
                    hover
                    selected={mission.id === selectedId}
                    onClick={() => setSelectedId(mission.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {mission.id.slice(0, 8)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {mission.workflowId.slice(0, 8)} v{mission.workflowVersion}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        label={mission.status}
                        tone={statusTone[mission.status]}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(mission.updatedAt).toLocaleString()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
        <Grid item xs={12} md={6}>
          {selected !== null ? (
            <MissionDetail mission={selected} onChanged={reload} />
          ) : (
            <Paper
              variant="outlined"
              sx={{
                p: 4,
                minHeight: 200,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography color="text.secondary" variant="body2">
                Select a mission to inspect its steps.
              </Typography>
            </Paper>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
