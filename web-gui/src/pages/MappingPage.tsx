import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../api/client';
import type { Level, Robot } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { useFetch } from '../hooks/useFetch';

/**
 * Drive one robot in SLAM, then upload the occupancy map for a level.
 */
export function MappingPage(): ReactElement {
  const { data: robots } = useFetch<Robot[]>('/api/v1/robots');
  const { data: levels } = useFetch<Level[]>('/api/v1/levels');
  const [robotId, setRobotId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMapping = async (action: 'start' | 'stop' | 'save'): Promise<void> => {
    if (!robotId) {
      setError('Select a robot');
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.post(`/api/v1/robots/${robotId}/mapping`, { action });
      setMsg(`Mapping ${action} queued for robot.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = e.target.files;
    if (!files || files.length < 2) {
      setError('Select both map.pgm and map.yaml');
      return;
    }
    if (!levelId) {
      setError('Select a level');
      return;
    }
    let pgm: File | null = null;
    let yamlFile: File | null = null;
    for (const f of Array.from(files)) {
      if (f.name.endsWith('.pgm')) pgm = f;
      if (f.name.endsWith('.yaml') || f.name.endsWith('.yml')) yamlFile = f;
    }
    if (!pgm || !yamlFile) {
      setError('Need one .pgm and one .yaml');
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const pgmBuf = await pgm.arrayBuffer();
      const yamlText = await yamlFile.text();
      const pgmBase64 = btoa(
        Array.from(new Uint8Array(pgmBuf), (b) => String.fromCharCode(b)).join(''),
      );
      await api.post(`/api/v1/levels/${levelId}/occupancy`, { pgmBase64, yamlText });
      setMsg('Occupancy map uploaded. Open Building editor to draw the nav graph on it.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <Box>
      <PageHeader
        title="Mapping"
        subtitle="Use one robot to generate a map when the site has no floor plan CAD."
      />
      {error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {msg !== null && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {msg}
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 640, lineHeight: 1.6 }}>
        1) Start mapping on a robot · 2) Drive with teleop · 3) Save on the robot · 4) Upload
        map.pgm + map.yaml here · 5) Draw lanes/chargers in Building editor.
      </Typography>

      <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, maxWidth: 560 }}>
        <Stack spacing={3}>
          <TextField
            select
            label="Mapping robot"
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
            fullWidth
          >
            {(robots ?? [])
              .filter((r) => !r.retired)
              .map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
          </TextField>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button variant="contained" disabled={busy} onClick={() => void sendMapping('start')}>
              Start SLAM
            </Button>
            <Button variant="outlined" disabled={busy} onClick={() => void sendMapping('save')}>
              Save map
            </Button>
            <Button variant="outlined" disabled={busy} onClick={() => void sendMapping('stop')}>
              Stop
            </Button>
          </Stack>

          <TextField
            select
            label="Upload to level"
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
            fullWidth
          >
            {(levels ?? []).map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="outlined" component="label" disabled={busy}>
            Upload map.pgm + map.yaml
            <input
              hidden
              type="file"
              multiple
              accept=".pgm,.yaml,.yml"
              onChange={(ev) => void onUpload(ev)}
            />
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
