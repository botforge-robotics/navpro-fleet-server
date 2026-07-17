import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { viewRadius } from '../theme/appTheme';

/** noVNC lite embed — no side control bar (that bar was crushing the canvas to a thin strip). */
function editorUrl(): string {
  const params = new URLSearchParams({
    autoconnect: '1',
    resize: 'scale',
    reconnect: '1',
    show_dot: '0',
    path: 'editor/websockify',
  });
  return `/editor/vnc_lite.html?${params.toString()}`;
}

/**
 * Building authoring uses the official Open-RMF traffic-editor Qt GUI
 * (https://github.com/open-rmf/rmf_traffic_editor) running in Docker and
 * streamed into this tab via noVNC. Saves go to the mounted site/ volume.
 */
export function BuildingEditorPage(): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importYaml, setImportYaml] = useState('');
  const [iframeKey, setIframeKey] = useState(0);

  const editorSrc = useMemo(() => editorUrl(), []);

  const applySite = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const result = await api.post<{
        fleets?: string[];
        nav?: { ok: boolean; detail?: string };
        building?: { name: string };
      }>('/api/v1/site/apply-building');
      setMsg(
        `Applied ${result.building?.name ?? 'building'} from site/. ` +
          `fleets=${(result.fleets ?? []).join(',') || 'n/a'}; ` +
          `nav=${result.nav?.ok ? 'ok' : result.nav?.detail ?? 'skipped'}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const importBuilding = async (): Promise<void> => {
    if (!importYaml.trim()) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.post('/api/v1/site/import-building', { buildingYaml: importYaml });
      setMsg('Building imported into site/building.yaml. Restart traffic-editor iframe to open it.');
      setImportYaml('');
      setIframeKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: 'calc(100vh - 96px)',
        minHeight: 640,
        boxSizing: 'border-box',
      }}
    >
      <PageHeader
        title="Building editor"
        subtitle="Full Open-RMF traffic-editor (Qt) — draw lanes, doors, lifts, chargers on your floorplan."
      />

      <Alert severity="info" sx={{ mb: 2, flexShrink: 0 }}>
        This is the official{' '}
        <Link href="https://github.com/open-rmf/rmf_traffic_editor" target="_blank" rel="noreferrer">
          rmf_traffic_editor
        </Link>
        . File → Open/Save under <code>/site/</code> (e.g. <code>building.yaml</code>). After saving,
        click <strong>Apply to fleet</strong> so nav graphs and fleet config regenerate.
      </Alert>

      {error !== null && (
        <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }}>
          {error}
        </Alert>
      )}
      {msg !== null && (
        <Alert severity="success" sx={{ mb: 2, flexShrink: 0 }}>
          {msg}
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexShrink: 0 }} flexWrap="wrap" useFlexGap>
        <Button variant="contained" disabled={busy} onClick={() => void applySite()}>
          Apply to fleet
        </Button>
        <Button variant="outlined" disabled={busy} onClick={() => setIframeKey((k) => k + 1)}>
          Reload editor
        </Button>
        <Button variant="outlined" href={editorSrc} target="_blank" rel="noreferrer">
          Open in new tab
        </Button>
      </Stack>

      {/* Absolute-fill iframe so noVNC gets a real width×height (flex % height alone was collapsing the canvas). */}
      <Box
        sx={{
          flex: '1 1 auto',
          width: '100%',
          minHeight: '65vh',
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: `${viewRadius}px`,
          overflow: 'hidden',
          bgcolor: 'background.default',
          boxShadow: (theme) => theme.shadows[2],
        }}
      >
        <iframe
          key={iframeKey}
          title="rmf_traffic_editor"
          src={`${editorSrc}&t=${iframeKey}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          allow="fullscreen"
        />
      </Box>

      <Box sx={{ mt: 2, flexShrink: 0 }}>
        <Typography variant="subtitle2" gutterBottom>
          Or paste a .building.yaml (laptop traffic-editor export)
        </Typography>
        <TextField
          multiline
          minRows={2}
          fullWidth
          placeholder="Paste building.yaml here…"
          value={importYaml}
          onChange={(e) => setImportYaml(e.target.value)}
        />
        <Button sx={{ mt: 1 }} onClick={() => void importBuilding()} disabled={busy}>
          Import building.yaml
        </Button>
      </Box>
    </Box>
  );
}
