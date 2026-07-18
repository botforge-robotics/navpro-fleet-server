import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { viewRadius } from '../theme/appTheme';

/**
 * Custom noVNC embed served by traffic-editor.
 * Always scaleViewport=true so the Qt desktop fits the iframe (no scrollbars).
 */
function editorUrl(): string {
  const params = new URLSearchParams({
    autoconnect: '1',
    path: 'editor/websockify',
  });
  return `/editor/navpro-embed.html?${params.toString()}`;
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
  const [showImport, setShowImport] = useState(false);

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
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ mb: 1.5, flexShrink: 0 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Building editor
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Official{' '}
            <Link href="https://github.com/open-rmf/rmf_traffic_editor" target="_blank" rel="noreferrer">
              rmf_traffic_editor
            </Link>
            {' — '}
            File → Save under <code>/site/</code>, then Apply to fleet.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
          <Button variant="contained" size="small" disabled={busy} onClick={() => void applySite()}>
            Apply to fleet
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            onClick={() => setIframeKey((k) => k + 1)}
          >
            Reload editor
          </Button>
          <Button variant="outlined" size="small" href={editorSrc} target="_blank" rel="noreferrer">
            Open in new tab
          </Button>
          <Button variant="text" size="small" onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Hide import' : 'Import YAML'}
          </Button>
        </Stack>
      </Stack>

      {error !== null && (
        <Alert severity="error" sx={{ mb: 1.5, flexShrink: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {msg !== null && (
        <Alert severity="success" sx={{ mb: 1.5, flexShrink: 0 }} onClose={() => setMsg(null)}>
          {msg}
        </Alert>
      )}

      <Collapse in={showImport} sx={{ flexShrink: 0 }}>
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" gutterBottom>
            Paste a .building.yaml (laptop traffic-editor export)
          </Typography>
          <TextField
            multiline
            minRows={2}
            fullWidth
            size="small"
            placeholder="Paste building.yaml here…"
            value={importYaml}
            onChange={(e) => setImportYaml(e.target.value)}
          />
          <Button sx={{ mt: 1 }} size="small" onClick={() => void importBuilding()} disabled={busy}>
            Import building.yaml
          </Button>
        </Box>
      </Collapse>

      {/* Absolute-fill iframe: noVNC scales the remote desktop to this box. */}
      <Box
        sx={{
          flex: '1 1 auto',
          width: '100%',
          minHeight: 0,
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: `${viewRadius}px`,
          overflow: 'hidden',
          bgcolor: '#0f1419',
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
            display: 'block',
          }}
          allow="fullscreen"
        />
      </Box>
    </Box>
  );
}
