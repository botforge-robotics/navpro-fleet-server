import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Mission, MissionStepState } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusChip, type StatusTone } from '../../components/StatusChip';

const stepTone: Record<MissionStepState, StatusTone> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  retrying: 'warning',
  compensating: 'warning',
  compensated: 'neutral',
  skipped: 'neutral',
};

interface MissionDetailProps {
  mission: Mission;
  onChanged: () => void;
}

/** Step list with saga states and operator actions (retry / skip / cancel). */
export function MissionDetail({ mission, onChanged }: MissionDetailProps): ReactElement {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (path: string): Promise<void> => {
    setBusy(true);
    try {
      await api.post(path);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const active =
    mission.status === 'running' || mission.status === 'needs_operator';
  const failedStep = mission.steps.find((s) => s.state === 'failed');

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, gap: 2, alignItems: 'flex-start' }}>
        <Typography variant="h5" sx={{ fontWeight: 600, letterSpacing: '-0.02em' }}>
          Mission {mission.id.slice(0, 8)}
        </Typography>
        <StatusChip
          label={mission.status}
          tone={
            mission.status === 'completed'
              ? 'success'
              : mission.status === 'failed' || mission.status === 'cancelled'
                ? 'error'
                : mission.status === 'needs_operator'
                  ? 'warning'
                  : 'info'
          }
        />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Workflow {mission.workflowId.slice(0, 8)} v{mission.workflowVersion}
        {mission.robotId !== null ? ` - robot ${mission.robotId.slice(0, 8)}` : ''}
      </Typography>
      <List dense>
        {mission.steps.map((step) => (
          <ListItem
            key={step.id}
            secondaryAction={<StatusChip label={step.state} tone={stepTone[step.state]} />}
          >
            <ListItemText
              primary={`${step.index + 1}. ${step.name} (${step.type})`}
              secondary={
                step.error !== null
                  ? `attempts ${step.attempts} - ${step.error}`
                  : `attempts ${step.attempts}`
              }
            />
          </ListItem>
        ))}
      </List>
      <Divider sx={{ my: 1 }} />
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          disabled={busy || failedStep === undefined}
          onClick={() =>
            void act(
              `/api/v1/missions/${mission.id}/steps/${failedStep?.id ?? ''}/retry`,
            )
          }
        >
          Retry failed step
        </Button>
        <Button
          variant="outlined"
          disabled={busy || failedStep === undefined}
          onClick={() =>
            void act(
              `/api/v1/missions/${mission.id}/steps/${failedStep?.id ?? ''}/skip`,
            )
          }
        >
          Skip failed step
        </Button>
        <Button
          variant="outlined"
          color="error"
          disabled={busy || !active}
          onClick={() => setCancelOpen(true)}
        >
          Cancel mission
        </Button>
      </Stack>
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel mission"
        message="Cancel this mission? Compensation steps declared by the workflow will run for completed steps."
        confirmLabel="Cancel mission"
        destructive
        onConfirm={() => {
          setCancelOpen(false);
          void act(`/api/v1/missions/${mission.id}/cancel`);
        }}
        onCancel={() => setCancelOpen(false)}
      />
    </Paper>
  );
}
