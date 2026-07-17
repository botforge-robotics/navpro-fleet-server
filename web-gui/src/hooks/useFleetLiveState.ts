import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Alarm, Robot } from '../api/types';
import { fleetWs } from '../api/ws';

export interface FleetLiveState {
  robots: Robot[];
  alarms: Alarm[];
  wsConnected: boolean;
  /** Timestamp (ms) of the last live update, for staleness indication. */
  lastUpdateMs: number | null;
}

// Live fleet state: websocket-fed with a REST fallback poll while the socket
// is down, so the overview degrades to slow-but-correct instead of blank.
const REST_FALLBACK_INTERVAL_MS = 5000;

export function useFleetLiveState(): FleetLiveState {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastUpdateMs, setLastUpdateMs] = useState<number | null>(null);

  useEffect(() => {
    const offMessage = fleetWs.onMessage((msg) => {
      if (msg.type === 'robot_state') {
        setRobots(msg.robots);
        setLastUpdateMs(Date.now());
      } else if (msg.type === 'alarm') {
        setAlarms((prev) => {
          const rest = prev.filter((a) => a.id !== msg.alarm.id);
          return msg.alarm.acknowledged ? rest : [...rest, msg.alarm];
        });
      }
    });
    const offStatus = fleetWs.onStatus(setWsConnected);
    fleetWs.connect();
    return () => {
      offMessage();
      offStatus();
    };
  }, []);

  useEffect(() => {
    if (wsConnected) return;
    let cancelled = false;
    const poll = (): void => {
      api
        .get<Robot[]>('/api/v1/robots')
        .then((data) => {
          if (!cancelled) {
            setRobots(data);
            setLastUpdateMs(Date.now());
          }
        })
        .catch(() => undefined);
      api
        .get<Alarm[]>('/api/v1/alarms?active=true')
        .then((data) => {
          if (!cancelled) setAlarms(data);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, REST_FALLBACK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wsConnected]);

  return useMemo(
    () => ({ robots, alarms, wsConnected, lastUpdateMs }),
    [robots, alarms, wsConnected, lastUpdateMs],
  );
}
