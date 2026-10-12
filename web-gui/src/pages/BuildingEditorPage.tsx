import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../api/client';
import { viewRadius } from '../theme/appTheme';

function editorUrl(nonce: number): string {
  const params = new URLSearchParams({
    autoconnect: '1',
    path: 'editor/websockify',
    _: String(nonce),
  });
  return `/editor/navpro-embed.html?${params.toString()}`;
}

/**
 * Building authoring uses the official Open-RMF traffic-editor Qt GUI
 * streamed into this tab via noVNC. Saves go to the mounted site/ volume.
 */
export function BuildingEditorPage({ embedded = false }: { embedded?: boolean }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const editorSrc = editorUrl(iframeKey);

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

  const reloadDrawing = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.post('/api/v1/site/reload-traffic-editor');
      // Give the container a moment to relaunch Qt with the latest floorplan.
      await new Promise((r) => setTimeout(r, 2500));
      setIframeKey((k) => k + 1);
      setMsg('Traffic editor reloaded with the latest floorplan.');
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
            {embedded ? 'Graph & lanes' : 'Building editor'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Official{' '}
            <Link href="https://github.com/open-rmf/rmf_traffic_editor" target="_blank" rel="noreferrer">
              rmf_traffic_editor
            </Link>
            {' — '}
            File → Save under <code>/site/</code>, then Apply to fleet. After Map editor save, use Reload
            drawing if the floorplan looks stale.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            onClick={() => void reloadDrawing()}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            Reload drawing
          </Button>
          <Button variant="contained" size="small" disabled={busy} onClick={() => void applySite()}>
            Apply to fleet
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
          src={editorSrc}
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
