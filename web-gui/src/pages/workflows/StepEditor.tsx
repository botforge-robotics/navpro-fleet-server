import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import type {
  OnFailurePolicy,
  WorkflowStep,
  WorkflowStepType,
} from '../../api/types';

const stepTypes: WorkflowStepType[] = [
  'goto',
  'wait',
  'capture_image',
  'publish',
  'call_service',
  'dock',
  'charge',
  'custom',
];

const failureActions = ['retry', 'compensate', 'halt_and_alert'] as const;

interface StepEditorProps {
  step: WorkflowStep;
  index: number;
  total: number;
  onChange: (step: WorkflowStep) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

function defaultPolicy(action: (typeof failureActions)[number]): OnFailurePolicy {
  if (action === 'retry') {
    return { action: 'retry', maxAttempts: 3, backoffSeconds: 10 };
  }
  return { action };
}

export function StepEditor({
  step,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: StepEditorProps): ReactElement {
  const [paramsText, setParamsText] = useState(
    JSON.stringify(step.params, null, 2),
  );
  const [paramsError, setParamsError] = useState<string | null>(null);

  const updateParams = (text: string): void => {
    setParamsText(text);
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParamsError('Params must be a JSON object.');
        return;
      }
      setParamsError(null);
      onChange({ ...step, params: parsed as Record<string, unknown> });
    } catch {
      setParamsError('Invalid JSON.');
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6">Step {index + 1}</Typography>
        <Box>
          <IconButton
            size="small"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="move up"
          >
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="move down"
          >
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onRemove} aria-label="remove step">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2}>
          <TextField
            label="Type"
            select
            value={step.type}
            onChange={(e) =>
              onChange({ ...step, type: e.target.value as WorkflowStepType })
            }
            sx={{ minWidth: 160 }}
          >
            {stepTypes.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Name"
            value={step.name}
            onChange={(e) => onChange({ ...step, name: e.target.value })}
            fullWidth
          />
        </Stack>
        <TextField
          label="Params (JSON)"
          value={paramsText}
          onChange={(e) => updateParams(e.target.value)}
          error={paramsError !== null}
          helperText={paramsError ?? 'e.g. {"waypoint": "dock_a"} for goto'}
          multiline
          minRows={2}
        />
        <Stack direction="row" spacing={2}>
          <TextField
            label="On failure"
            select
            value={step.onFailure.action}
            onChange={(e) =>
              onChange({
                ...step,
                onFailure: defaultPolicy(
                  e.target.value as (typeof failureActions)[number],
                ),
              })
            }
            sx={{ minWidth: 180 }}
          >
            {failureActions.map((a) => (
              <MenuItem key={a} value={a}>
                {a}
              </MenuItem>
            ))}
          </TextField>
          {step.onFailure.action === 'retry' && (
            <>
              <TextField
                label="Max attempts"
                type="number"
                value={step.onFailure.maxAttempts}
                onChange={(e) =>
                  onChange({
                    ...step,
                    onFailure: {
                      action: 'retry',
                      maxAttempts: Number(e.target.value),
                      backoffSeconds:
                        step.onFailure.action === 'retry'
                          ? step.onFailure.backoffSeconds
                          : 10,
                    },
                  })
                }
              />
              <TextField
                label="Backoff (s)"
                type="number"
                value={step.onFailure.backoffSeconds}
                onChange={(e) =>
                  onChange({
                    ...step,
                    onFailure: {
                      action: 'retry',
                      maxAttempts:
                        step.onFailure.action === 'retry'
                          ? step.onFailure.maxAttempts
                          : 3,
                      backoffSeconds: Number(e.target.value),
                    },
                  })
                }
              />
            </>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
