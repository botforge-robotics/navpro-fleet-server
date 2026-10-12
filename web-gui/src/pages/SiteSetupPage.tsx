import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import type { ReactElement, SyntheticEvent } from 'react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BuildingEditorPage } from './BuildingEditorPage';
import { MapCleanupPage } from './MapCleanupPage';
import { MappingPage } from './MappingPage';
import { ParkingWizardPage } from './ParkingWizardPage';

type SiteTab = 'mapping' | 'map-editor' | 'parking' | 'building';

const TAB_ORDER: SiteTab[] = ['mapping', 'map-editor', 'parking', 'building'];

function tabFromParam(raw: string | null): SiteTab {
  if (raw === 'map-editor' || raw === 'editor' || raw === 'clean') return 'map-editor';
  if (raw === 'parking' || raw === 'charger') return 'parking';
  if (raw === 'building' || raw === 'graph') return 'building';
  if (raw === 'mapping' || raw === 'slam') return 'mapping';
  return 'mapping';
}

/**
 * Single Building hub: Mapping → Map editor → Parking wizard → Building graph.
 * Mapping stays mounted (hidden) so SLAM state survives; Map editor remounts
 * when selected so Fit runs against a real viewport size (avoids half-window).
 */
export function SiteSetupPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const tab = useMemo(() => tabFromParam(params.get('tab')), [params]);
  const index = Math.max(0, TAB_ORDER.indexOf(tab));

  const setTab = (_e: SyntheticEvent, value: number): void => {
    const next = TAB_ORDER[value] ?? 'mapping';
    setParams(next === 'mapping' ? {} : { tab: next }, { replace: true });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Tabs
        value={index}
        onChange={setTab}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{
          flexShrink: 0,
          minHeight: 40,
          borderBottom: 1,
          borderColor: 'divider',
          px: { xs: 1, md: 1.5 },
          bgcolor: 'background.paper',
          '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 600 },
        }}
      >
        <Tab label="Mapping" />
        <Tab label="Map editor" />
        <Tab label="Parking" />
        <Tab label="Building" />
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Box
          sx={{
            display: index === 0 ? 'flex' : 'none',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
          }}
        >
          <MappingPage embedded />
        </Box>
        {index === 1 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              p: { xs: 1, md: 1.5 },
              boxSizing: 'border-box',
            }}
          >
            <MapCleanupPage embedded />
          </Box>
        )}
        {index === 2 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              p: { xs: 1, md: 1.5 },
              boxSizing: 'border-box',
              overflow: 'auto',
            }}
          >
            <ParkingWizardPage embedded />
          </Box>
        )}
        {index === 3 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              p: { xs: 1, md: 1.5 },
              boxSizing: 'border-box',
            }}
          >
            <BuildingEditorPage embedded />
          </Box>
        )}
      </Box>
    </Box>
  );
}
