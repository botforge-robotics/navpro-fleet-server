import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Workflow, WorkflowStep, WorkflowVersion } from '../../api/types';
import { StepEditor } from './StepEditor';

interface WorkflowBuilderProps {
  workflow: Workflow;
  /** Steps of the latest version, used as the editing base. */
  baseSteps: WorkflowStep[];
  onSaved: () => void;
}

let localIdCounter = 0;
function newStep(): WorkflowStep {
  localIdCounter += 1;
  return {
    id: `new-${localIdCounter}`,
    type: 'goto',
    name: 'New step',
    params: {},
    onFailure: { action: 'halt_and_alert' },
  };
}

/**
 * Ordered step editor. Saving POSTs the full step list to
 * /api/v1/workflows/:id/versions, which creates a new immutable version.
 */
export function WorkflowBuilder({
  workflow,
  baseSteps,
  onSaved,
}: WorkflowBuilderProps): ReactElement {
  const [steps, setSteps] = useState<WorkflowStep[]>(baseSteps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStep = (index: number, step: WorkflowStep): void => {
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  };

  const removeStep = (index: number): void => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, direction: -1 | 1): void => {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      const a = next[index];
      const b = next[target];
      if (a === undefined || b === undefined) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post<WorkflowVersion>(`/api/v1/workflows/${workflow.id}/versions`, {
        steps: steps.map((s, i) => ({ ...s, index: i })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">
          Editing {workflow.name} (base v{workflow.latestVersion})
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<AddIcon />}
            onClick={() => setSteps((prev) => [...prev, newStep()])}
          >
            Add step
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={busy || steps.length === 0}
            onClick={() => void save()}
          >
            Save as v{workflow.latestVersion + 1}
          </Button>
        </Stack>
      </Box>
      {error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={2}>
        {steps.map((step, index) => (
          <StepEditor
            key={step.id}
            step={step}
            index={index}
            total={steps.length}
            onChange={(s) => updateStep(index, s)}
            onRemove={() => removeStep(index)}
            onMove={(d) => moveStep(index, d)}
          />
        ))}
        {steps.length === 0 && (
          <Typography color="text.secondary">
            No steps. Add the first step to build the workflow.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
