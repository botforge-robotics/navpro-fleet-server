import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { Device, DeviceType } from '../api/types';
import { JsonView } from '../components/JsonView';
import { PageHeader } from '../components/PageHeader';
import { StatusChip, type StatusTone } from '../components/StatusChip';
import { useFetch } from '../hooks/useFetch';
import { CommissioningSection } from './CommissioningPage';

/** rmf_door_msgs/DoorMode */
const DOOR_MODE_CLOSED = 0;
const DOOR_MODE_OPEN = 1;
const DOOR_MODE_MOVING = 2;

interface RmfBuildingMap {
  name: string;
  levels: Array<{
    name: string;
    doors: Array<{ name: string; door_type: number }>;
  }>;
  lifts: Array<{ name: string; levels: string[] }>;
}

interface RmfDoorState {
  door_name: string;
  current_mode?: { value: number };
}

interface RmfLiftState {
  lift_name: string;
  current_floor?: string;
  destination_floor?: string;
  door_state?: number;
  current_mode?: number;
}

type DeviceSource = 'rmf' | 'registry';

interface UnifiedDevice {
  key: string;
  name: string;
  type: DeviceType;
  levelId: string | null;
  source: DeviceSource;
  status: Record<string, unknown>;
  health: Record<string, unknown> | null;
  registry?: Device;
}

const typeOrder: DeviceType[] = [
  'door',
  'lift',
  'dispenser',
  'charger',
  'plc',
  'camera',
  'custom_action',
];

function doorModeLabel(value: number | undefined): string {
  switch (value) {
    case DOOR_MODE_OPEN:
      return 'OPEN';
    case DOOR_MODE_CLOSED:
      return 'CLOSED';
    case DOOR_MODE_MOVING:
      return 'MOVING';
    default:
      return 'UNKNOWN';
  }
}

function doorModeTone(value: number | undefined): StatusTone {
  switch (value) {
    case DOOR_MODE_OPEN:
      return 'success';
    case DOOR_MODE_CLOSED:
      return 'neutral';
    case DOOR_MODE_MOVING:
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Registry plugin panel (chargers, cameras, etc., and doors/lifts when seeded).
 */
function RegistryDevicePanel({
  device,
  onChanged,
}: {
  device: Device;
  onChanged: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCommand = async (name: string, params: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/devices/${device.id}/command`, { command: name, args: params });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, mb: 1, alignItems: 'flex-start' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{device.name}</Typography>
          <StatusChip label="registry" tone="info" />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {device.type}
          {device.levelId !== null ? ` - level ${device.levelId}` : ''}
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Status
        </Typography>
        <JsonView value={device.status} maxHeight={140} />
        {device.capabilities.hasHealth && device.health !== null && (
          <>
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', my: 1.5 }}>
              Health
            </Typography>
            <JsonView value={device.health} maxHeight={100} />
          </>
        )}
        {device.capabilities.commands.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mt: 2.5, flexWrap: 'wrap' }} useFlexGap>
            {device.capabilities.commands.map((cmd) => (
              <Button
                key={cmd.name}
                variant="outlined"
                size="small"
                disabled={busy}
                onClick={() => void sendCommand(cmd.name, cmd.params)}
              >
                {cmd.label}
              </Button>
            ))}
          </Stack>
        )}
        {error !== null && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function RmfDoorPanel({
  name,
  levelName,
  modeValue,
  onRefresh,
}: {
  name: string;
  levelName: string;
  modeValue: number | undefined;
  onRefresh: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [transport, setTransport] = useState<'rmf-only' | 'http' | 'mqtt'>('http');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [topicCmd, setTopicCmd] = useState('');
  const [brokerUrl, setBrokerUrl] = useState('');

  const request = async (mode: number): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/rmf/doors/${encodeURIComponent(name)}/request`, { mode });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const linkHardware = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/devices/link', {
        name,
        type: 'door',
        transport,
        endpointUrl: transport === 'http' ? endpointUrl : undefined,
        topicCmd: transport === 'mqtt' ? topicCmd : undefined,
        brokerUrl: transport === 'mqtt' ? brokerUrl || undefined : undefined,
        doorName: name,
      });
      setLinkOpen(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, mb: 1, alignItems: 'flex-start' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{name}</Typography>
          <StatusChip label={doorModeLabel(modeValue)} tone={doorModeTone(modeValue)} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          door - level {levelName} (building map)
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2.5 }} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() => void request(DOOR_MODE_OPEN)}
          >
            Open
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            onClick={() => void request(DOOR_MODE_CLOSED)}
          >
            Close
          </Button>
          <Button size="small" disabled={busy} onClick={() => setLinkOpen((v) => !v)}>
            Link hardware
          </Button>
        </Stack>
        {linkOpen && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Typography variant="body2">HTTP webhook or MQTT topic for this door</Typography>
            <Button
              size="small"
              variant={transport === 'http' ? 'contained' : 'outlined'}
              onClick={() => setTransport('http')}
            >
              HTTP
            </Button>
            <Button
              size="small"
              variant={transport === 'mqtt' ? 'contained' : 'outlined'}
              onClick={() => setTransport('mqtt')}
            >
              MQTT
            </Button>
            {transport === 'http' && (
              <input
                placeholder="https://plc.local/api/door"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                style={{ padding: 8 }}
              />
            )}
            {transport === 'mqtt' && (
              <>
                <input
                  placeholder="doors/front/cmd"
                  value={topicCmd}
                  onChange={(e) => setTopicCmd(e.target.value)}
                  style={{ padding: 8 }}
                />
                <input
                  placeholder="mqtt://mosquitto:1883 (optional)"
                  value={brokerUrl}
                  onChange={(e) => setBrokerUrl(e.target.value)}
                  style={{ padding: 8 }}
                />
              </>
            )}
            <Button size="small" variant="contained" disabled={busy} onClick={() => void linkHardware()}>
              Save link
            </Button>
          </Stack>
        )}
        {error !== null && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function RmfLiftPanel({
  name,
  floors,
  state,
}: {
  name: string;
  floors: string[];
  state: RmfLiftState | null;
}): ReactElement {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>{name}</Typography>
        <Typography variant="caption" color="text.secondary">
          lift - floors {floors.join(', ') || 'n/a'} (building map)
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Typography variant="body2">
          Floor: {state?.current_floor ?? 'n/a'}
          {state?.destination_floor ? ` → ${state.destination_floor}` : ''}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, lineHeight: 1.55 }}>
          Live lift requests stay on the Overview doors/lifts panels for now.
        </Typography>
      </CardContent>
    </Card>
  );
}

export function DevicesPage(): ReactElement {
  const {
    data: registryDevices,
    error: registryError,
    reload: reloadRegistry,
  } = useFetch<Device[]>('/api/v1/devices');

  const [buildingMap, setBuildingMap] = useState<RmfBuildingMap | null>(null);
  const [doorStates, setDoorStates] = useState<Record<string, RmfDoorState>>({});
  const [liftStates, setLiftStates] = useState<Record<string, RmfLiftState>>({});
  const [rmfError, setRmfError] = useState<string | null>(null);
  const [rmfEpoch, setRmfEpoch] = useState(0);

  const loadRmf = useCallback(async () => {
    try {
      const map = await api.get<RmfBuildingMap>('/rmf/building_map');
      setBuildingMap(map);
      setRmfError(null);

      const doorNames = map.levels.flatMap((l) => l.doors.map((d) => d.name));
      const nextDoors: Record<string, RmfDoorState> = {};
      await Promise.all(
        doorNames.map(async (name) => {
          try {
            nextDoors[name] = await api.get<RmfDoorState>(
              `/rmf/doors/${encodeURIComponent(name)}/state`,
            );
          } catch {
            nextDoors[name] = { door_name: name };
          }
        }),
      );
      setDoorStates(nextDoors);

      const nextLifts: Record<string, RmfLiftState> = {};
      await Promise.all(
        (map.lifts ?? []).map(async (lift) => {
          try {
            nextLifts[lift.name] = await api.get<RmfLiftState>(
              `/rmf/lifts/${encodeURIComponent(lift.name)}/state`,
            );
          } catch {
            nextLifts[lift.name] = { lift_name: lift.name };
          }
        }),
      );
      setLiftStates(nextLifts);
    } catch (err) {
      setBuildingMap(null);
      // RMF returns FastAPI 404 until building_map_server publishes a map.
      if (err instanceof ApiError && err.status === 404) {
        setRmfError(null);
        return;
      }
      setRmfError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadRmf();
    const id = window.setInterval(() => void loadRmf(), 5000);
    return () => window.clearInterval(id);
  }, [loadRmf, rmfEpoch]);

  const registryByName = useMemo(() => {
    const map = new Map<string, Device>();
    for (const d of registryDevices ?? []) {
      map.set(d.name, d);
    }
    return map;
  }, [registryDevices]);

  const unified = useMemo(() => {
    const items: UnifiedDevice[] = [];
    const seen = new Set<string>();

    if (buildingMap) {
      for (const level of buildingMap.levels) {
        for (const door of level.doors) {
          const reg = registryByName.get(door.name);
          if (reg) {
            items.push({
              key: `door:${door.name}`,
              name: door.name,
              type: 'door',
              levelId: level.name,
              source: 'registry',
              status: reg.status,
              health: reg.health,
              registry: reg,
            });
          } else {
            const state = doorStates[door.name];
            items.push({
              key: `door:${door.name}`,
              name: door.name,
              type: 'door',
              levelId: level.name,
              source: 'rmf',
              status: {
                mode: doorModeLabel(state?.current_mode?.value),
                current_mode: state?.current_mode ?? null,
              },
              health: null,
            });
          }
          seen.add(door.name);
        }
      }
      for (const lift of buildingMap.lifts ?? []) {
        const reg = registryByName.get(lift.name);
        if (reg) {
          items.push({
            key: `lift:${lift.name}`,
            name: lift.name,
            type: 'lift',
            levelId: null,
            source: 'registry',
            status: reg.status,
            health: reg.health,
            registry: reg,
          });
        } else {
          items.push({
            key: `lift:${lift.name}`,
            name: lift.name,
            type: 'lift',
            levelId: null,
            source: 'rmf',
            status: (liftStates[lift.name] as unknown as Record<string, unknown>) ?? {},
            health: null,
          });
        }
        seen.add(lift.name);
      }
    }

    for (const d of registryDevices ?? []) {
      if (seen.has(d.name)) continue;
      if (d.type === 'door' || d.type === 'lift') {
        // Prefer RMF list for doors/lifts; orphan registry-only still shown.
      }
      items.push({
        key: `reg:${d.id}`,
        name: d.name,
        type: d.type,
        levelId: d.levelId,
        source: 'registry',
        status: d.status,
        health: d.health,
        registry: d,
      });
    }

    return items;
  }, [buildingMap, doorStates, liftStates, registryByName, registryDevices]);

  const grouped = typeOrder
    .map((type) => ({
      type,
      items: unified.filter((d) => d.type === type),
    }))
    .filter((g) => g.items.length > 0);

  const refreshAll = (): void => {
    reloadRegistry();
    setRmfEpoch((n) => n + 1);
  };

  return (
    <Box>
      <PageHeader
        title="Devices"
        subtitle="Commission robots onto the fleet, and control building hardware (doors, lifts, chargers)."
      />
      <CommissioningSection />
      <Box
        sx={{
          mt: 1,
          mb: 3,
          pt: 3,
          borderTop: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
      <Typography variant="h5" sx={{ mb: 0.5, letterSpacing: '-0.01em' }}>
        Building hardware
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Doors and lifts from the live map, plus registered chargers, cameras, and plugins. Map
        geometry is edited in the Building traffic editor.
      </Typography>
      {registryError !== null && <Alert severity="warning" sx={{ mb: 2 }}>{registryError}</Alert>}
      {rmfError !== null && <Alert severity="error" sx={{ mb: 2 }}>{rmfError}</Alert>}
      {grouped.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No building hardware yet. Open the <strong>Building</strong> tab, save a map with
          doors/lifts/chargers, click <strong>Apply to fleet</strong>, then wait a few seconds
          (RMF must load <code>site/*.building.yaml</code>). Chargers and cameras can also be
          registered as platform devices.
        </Alert>
      )}
      {grouped.map((group) => (
        <Box key={group.type} sx={{ mb: 3 }}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: 'block', mb: 1.5, letterSpacing: '0.08em' }}
          >
            {group.type}
          </Typography>
          <Grid container spacing={2}>
            {group.items.map((item) => (
              <Grid item xs={12} sm={6} md={4} key={item.key}>
                {item.registry ? (
                  <RegistryDevicePanel device={item.registry} onChanged={refreshAll} />
                ) : item.type === 'door' ? (
                  <RmfDoorPanel
                    name={item.name}
                    levelName={item.levelId ?? 'n/a'}
                    modeValue={doorStates[item.name]?.current_mode?.value}
                    onRefresh={refreshAll}
                  />
                ) : item.type === 'lift' ? (
                  <RmfLiftPanel
                    name={item.name}
                    floors={
                      buildingMap?.lifts.find((l) => l.name === item.name)?.levels ?? []
                    }
                    state={liftStates[item.name] ?? null}
                  />
                ) : null}
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
      </Box>
    </Box>
  );
}
