import AddIcon from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../api/client';
import type { Fleet, Workflow, WorkflowVersion } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { useFetch } from '../hooks/useFetch';
import { VersionHistory } from './workflows/VersionHistory';
import { WorkflowBuilder } from './workflows/WorkflowBuilder';

export function WorkflowsPage(): ReactElement {
  const {
    data: workflows,
    error,
    reload,
  } = useFetch<Workflow[]>('/api/v1/workflows');
  const { data: fleets } = useFetch<Fleet[]>('/api/v1/fleets');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selected = workflows?.find((w) => w.id === selectedId) ?? null;
  const { data: versions, reload: reloadVersions } = useFetch<WorkflowVersion[]>(
    selected !== null ? `/api/v1/workflows/${selected.id}/versions` : null,
  );

  const latestVersion =
    versions?.find((v) => v.version === selected?.latestVersion) ?? null;

  return (
    <Box>
      <PageHeader
        title="Workflows"
        subtitle="Versioned mission templates compiled to RMF tasks by the platform"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
          >
            New workflow
          </Button>
        }
      />
      {error !== null && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      <Grid container spacing={3}>
        <Grid item xs={12} md={3}>
          <Paper variant="outlined" sx={{ p: 1, overflow: 'hidden' }}>
            <List dense disablePadding>
              {(workflows ?? []).map((w) => (
                <ListItemButton
                  key={w.id}
                  selected={w.id === selectedId}
                  onClick={() => setSelectedId(w.id)}
                >
                  <ListItemText
                    primary={w.name}
                    secondary={`v${w.latestVersion} - ${w.description}`}
                    primaryTypographyProps={{ fontWeight: 600 }}
                  />
                </ListItemButton>
              ))}
            </List>
            {(workflows ?? []).length === 0 && (
              <Typography color="text.secondary" variant="body2" sx={{ p: 3, textAlign: 'center' }}>
                No workflows yet.
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={9}>
          {selected === null ? (
            <Paper
              variant="outlined"
              sx={{
                p: 4,
                minHeight: 240,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography color="text.secondary" variant="body2">
                Select a workflow to edit steps and versions.
              </Typography>
            </Paper>
          ) : (
            <Box>
              <WorkflowBuilder
                key={`${selected.id}-v${selected.latestVersion}`}
                workflow={selected}
                baseSteps={latestVersion?.steps ?? []}
                onSaved={() => {
                  reload();
                  reloadVersions();
                }}
              />
              <Divider sx={{ my: 3 }} />
              <VersionHistory
                workflow={selected}
                versions={versions ?? []}
                fleets={fleets ?? []}
              />
            </Box>
          )}
        </Grid>
      </Grid>
      {createOpen && (
        <CreateWorkflowDialog
          onClose={(created) => {
            setCreateOpen(false);
            if (created) reload();
          }}
        />
      )}
    </Box>
  );
}

function CreateWorkflowDialog({
  onClose,
}: {
  onClose: (created: boolean) => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Workflow>('/api/v1/workflows', { name, description });
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => onClose(false)} maxWidth="xs" fullWidth>
      <DialogTitle>New workflow</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />
          {error !== null && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button
          onClick={() => void create()}
          variant="contained"
          disabled={busy || name.trim() === ''}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
