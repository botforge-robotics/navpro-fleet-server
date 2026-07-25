import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Level } from '../api/types';
import { useFetch } from '../hooks/useFetch';

type SpotKind = 'parking' | 'charger' | 'stop';

/**
 * Simple parking/charger wizard → POST /site/parking-spots (patches building YAML + apply).
 */
export function ParkingWizardPage({ embedded = false }: { embedded?: boolean }): ReactElement {
  const { data: levels } = useFetch<Level[]>('/api/v1/levels');
  const levelList = levels ?? [];
  const defaultLevel = useMemo(
    () => levelList.find((l) => l.name === 'L1') ?? levelList[0],
    [levelList],
  );

  const [levelName, setLevelName] = useState('');
  const [name, setName] = useState('parking1');
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [yaw, setYaw] = useState('0');
  const [kind, setKind] = useState<SpotKind>('parking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const effectiveLevel = levelName || defaultLevel?.name || 'L1';

  const submit = async (apply: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const result = await api.post<{
        ok: boolean;
        spots: number;
        applied?: boolean;
        reloadRequired?: boolean;
      }>('/api/v1/site/parking-spots', {
        apply,
        spots: [
          {
            levelName: effectiveLevel,
            name: name.trim(),
            x: Number(x),
            y: Number(y),
            yaw: Number(yaw) || 0,
            kind,
          },
        ],
      });
      setMsg(
        apply
          ? `Saved ${result.spots} spot(s) and applied to fleet${
              result.reloadRequired ? ' (RMF reload requested)' : ''
            }.`
          : `Saved ${result.spots} spot(s) to building YAML (not applied).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ p: embedded ? 0 : 2, maxWidth: 560 }}>
      {!embedded && (
        <Typography variant="h6" sx={{ mb: 1 }}>
          Parking / charger wizard
        </Typography>
      )}
      <Alert severity="info" sx={{ mb: 2 }}>
        Add a parking or charger waypoint in building meters (same frame as the occupancy map).
        Prefer this for day-1 spots; use the full Building editor for lanes and doors.
      </Alert>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {msg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg(null)}>
          {msg}
        </Alert>
      )}
      <Stack spacing={2}>
        <FormControl fullWidth size="small">
          <InputLabel id="parking-level">Level</InputLabel>
          <Select
            labelId="parking-level"
            label="Level"
            value={effectiveLevel}
            onChange={(e) => setLevelName(String(e.target.value))}
          >
            {levelList.map((l) => (
              <MenuItem key={l.id} value={l.name}>
                {l.name}
              </MenuItem>
            ))}
            {levelList.length === 0 && <MenuItem value="L1">L1</MenuItem>}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="Waypoint name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
        />
        <FormControl fullWidth size="small">
          <InputLabel id="parking-kind">Kind</InputLabel>
          <Select
            labelId="parking-kind"
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as SpotKind)}
          >
            <MenuItem value="parking">Parking</MenuItem>
            <MenuItem value="charger">Charger</MenuItem>
            <MenuItem value="stop">Holding / stop</MenuItem>
          </Select>
        </FormControl>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="X (m)"
            value={x}
            onChange={(e) => setX(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Y (m)"
            value={y}
            onChange={(e) => setY(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Yaw (rad)"
            value={yaw}
            onChange={(e) => setYaw(e.target.value)}
            fullWidth
          />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            disabled={busy || !name.trim()}
            onClick={() => void submit(false)}
          >
            Save only
          </Button>
          <Button
            variant="contained"
            disabled={busy || !name.trim()}
            onClick={() => void submit(true)}
          >
            Save &amp; apply
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
