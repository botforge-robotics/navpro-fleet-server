import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Fleet, Workflow, WorkflowVersion } from '../../api/types';
import { JsonView } from '../../components/JsonView';
import { useFetch } from '../../hooks/useFetch';
import { jsonDiff } from './jsonDiff';

interface VersionHistoryProps {
  workflow: Workflow;
  versions: WorkflowVersion[];
  fleets: Fleet[];
}

/** Version list with view / diff-to-previous / submit-to-fleet actions. */
export function VersionHistory({
  workflow,
  versions,
  fleets,
}: VersionHistoryProps): ReactElement {
  const [viewVersion, setViewVersion] = useState<WorkflowVersion | null>(null);
  const [diffVersion, setDiffVersion] = useState<WorkflowVersion | null>(null);
  const [submitVersion, setSubmitVersion] = useState<WorkflowVersion | null>(null);

  const sorted = [...versions].sort((a, b) => b.version - a.version);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Version history
      </Typography>
      <List dense>
        {sorted.map((v) => (
          <ListItem
            key={v.id}
            secondaryAction={
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setViewVersion(v)}>
                  View
                </Button>
                <Button
                  size="small"
                  disabled={v.version === 1}
                  onClick={() => setDiffVersion(v)}
                >
                  Diff
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSubmitVersion(v)}
                >
                  Submit
                </Button>
              </Stack>
            }
          >
            <ListItemText
              primary={`v${v.version} - ${v.steps.length} step(s)`}
              secondary={`${v.author} - ${new Date(v.createdAt).toLocaleString()}`}
            />
          </ListItem>
        ))}
      </List>

      {viewVersion !== null && (
        <Dialog open onClose={() => setViewVersion(null)} maxWidth="md" fullWidth>
          <DialogTitle>
            {workflow.name} v{viewVersion.version}
          </DialogTitle>
          <DialogContent>
            <JsonView value={viewVersion.steps} maxHeight={480} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setViewVersion(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      {diffVersion !== null && (
        <DiffDialog
          workflow={workflow}
          version={diffVersion}
          previous={versions.find((v) => v.version === diffVersion.version - 1) ?? null}
          onClose={() => setDiffVersion(null)}
        />
      )}

      {submitVersion !== null && (
        <SubmitDialog
          workflow={workflow}
          version={submitVersion}
          fleets={fleets}
          onClose={() => setSubmitVersion(null)}
        />
      )}
    </Box>
  );
}

function DiffDialog({
  workflow,
  version,
  previous,
  onClose,
}: {
  workflow: Workflow;
  version: WorkflowVersion;
  previous: WorkflowVersion | null;
  onClose: () => void;
}): ReactElement {
  const lines =
    previous !== null ? jsonDiff(previous.steps, version.steps) : [];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {workflow.name}: v{previous?.version ?? '?'} to v{version.version}
      </DialogTitle>
      <DialogContent>
        {previous === null ? (
          <Typography color="text.secondary">
            Previous version not loaded.
          </Typography>
        ) : lines.length === 0 ? (
          <Typography color="text.secondary">No differences.</Typography>
        ) : (
          <List dense>
            {lines.map((line, i) => (
              <ListItem key={`${line.path}-${i}`}>
                <ListItemText
                  primary={`${line.kind.toUpperCase()} ${line.path}`}
                  secondary={
                    line.kind === 'added'
                      ? line.after
                      : line.kind === 'removed'
                        ? line.before
                        : `${line.before} to ${line.after}`
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function SubmitDialog({
  workflow,
  version,
  fleets,
  onClose,
}: {
  workflow: Workflow;
  version: WorkflowVersion;
  fleets: Fleet[];
  onClose: () => void;
}): ReactElement {
  const [fleetId, setFleetId] = useState(fleets[0]?.id ?? '');
  const [robotId, setRobotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: robots } = useFetch<Array<{ id: string; name: string }>>(
    fleetId !== '' ? `/api/v1/robots?fleetId=${encodeURIComponent(fleetId)}` : null,
  );

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/missions', {
        workflowId: workflow.id,
        workflowVersion: version.version,
        fleetId,
        robotId: robotId === '' ? null : robotId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        Submit {workflow.name} v{version.version}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
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
            label="Robot (optional, else RMF allocates)"
            select
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
          >
            <MenuItem value="">Auto-assign</MenuItem>
            {(robots ?? []).map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>
          {error !== null && (
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => void submit()}
          variant="contained"
          disabled={busy || fleetId === ''}
        >
          Submit mission
        </Button>
      </DialogActions>
    </Dialog>
  );
}
