import ArchitectureIcon from '@mui/icons-material/Architecture';
import MapIcon from '@mui/icons-material/Map';
import RefreshIcon from '@mui/icons-material/Refresh';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map } from 'rmf-dashboard-framework/components';
import { ApiError, api } from '../api/client';
import { viewRadius } from '../theme/appTheme';

interface BuildingMapSummary {
  name?: string;
  levels?: Array<{
    name?: string;
    images?: unknown[];
    doors?: unknown[];
    nav_graphs?: Array<{ vertices?: unknown[] }>;
    navGraphs?: Array<{ vertices?: unknown[] }>;
  }>;
}

export type MapReadyState = 'loading' | 'ready' | 'empty';

function summarizeMap(map: BuildingMapSummary | null): MapReadyState {
  if (map === null) return 'empty';
  const levels = map.levels ?? [];
  if (levels.length === 0) return 'empty';
  const hasContent = levels.some((level) => {
    const images = level.images?.length ?? 0;
    const doors = level.doors?.length ?? 0;
    const graphs = level.nav_graphs ?? level.navGraphs ?? [];
    const verts = graphs.reduce((n, g) => n + (g.vertices?.length ?? 0), 0);
    return images > 0 || doors > 0 || verts > 0;
  });
  return hasContent ? 'ready' : 'empty';
}

const mapConfig = {
  attributionPrefix: 'NavPro / Open-RMF',
  defaultMapLevel: 'L1',
  defaultRobotZoom: 20,
  defaultZoom: 20,
} as const;

/**
 * Full-bleed Map tab with an empty-state panel when RMF has no building map yet.
 */
export function MapTab(): ReactElement {
  const navigate = useNavigate();
  const [state, setState] = useState<MapReadyState>('loading');
  const [detail, setDetail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const checkMap = useCallback(async () => {
    setChecking(true);
    try {
      const map = await api.get<BuildingMapSummary>('/rmf/building_map');
      setState(summarizeMap(map));
      setDetail(map.name ? `Loaded building “${map.name}”.` : null);
    } catch (err) {
      setState('empty');
      if (err instanceof ApiError && err.status === 404) {
        setDetail('RMF has not published a building map yet.');
      } else {
        setDetail(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkMap();
    const id = window.setInterval(() => void checkMap(), 8000);
    return () => window.clearInterval(id);
  }, [checkMap]);

  if (state === 'ready') {
    return (
      <Box
        sx={{
          height: 'calc(100vh - 3.5rem)',
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        <Map {...mapConfig} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: 'calc(100vh - 3.5rem)',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 3,
        py: 4,
        bgcolor: 'background.default',
        backgroundImage: (theme) =>
          `radial-gradient(ellipse at 30% 20%, ${theme.palette.primary.main}18, transparent 50%),
           radial-gradient(ellipse at 70% 80%, ${theme.palette.secondary.main}12, transparent 45%)`,
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 560,
          p: { xs: 3, md: 4 },
          borderRadius: `${viewRadius}px`,
          border: (theme) => `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          boxShadow: 3,
        }}
      >
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
          Live map
        </Typography>
        <Typography variant="h4" sx={{ mt: 0.5, mb: 1.5, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {state === 'loading' ? 'Checking building map…' : 'No floor map to show yet'}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.6 }}>
          The Map tab shows your building once RMF loads a floor plan and navigation
          graph. Create or import a building, then apply it to the fleet.
        </Typography>

        {detail !== null && state !== 'loading' && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            {detail}
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ mb: 1.25 }}>
          What to do next
        </Typography>
        <Box
          component="ol"
          sx={{
            m: 0,
            mb: 3,
            pl: 2.5,
            color: 'text.secondary',
            '& li': { mb: 1, lineHeight: 1.5 },
          }}
        >
          <li>
            <strong>Mapping</strong> — if you have no CAD, drive one robot with SLAM and
            upload the occupancy map.
          </li>
          <li>
            <strong>Building</strong> — draw lanes, chargers, doors, and lifts on the floor,
            then click <strong>Apply to fleet</strong>.
          </li>
          <li>Wait a few seconds (or refresh) — this page updates when the map is live.</li>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
          <Button
            variant="contained"
            startIcon={<ArchitectureIcon />}
            onClick={() => navigate('/building')}
          >
            Open Building editor
          </Button>
          <Button
            variant="outlined"
            startIcon={<MapIcon />}
            onClick={() => navigate('/mapping')}
          >
            Go to Mapping
          </Button>
          <Button
            variant="text"
            startIcon={<RefreshIcon />}
            disabled={checking || state === 'loading'}
            onClick={() => void checkMap()}
          >
            Check again
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
