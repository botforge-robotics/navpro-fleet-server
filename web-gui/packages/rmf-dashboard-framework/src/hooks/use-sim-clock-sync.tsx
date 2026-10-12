import React from 'react';

import { AppEvents } from '../components/app-events';
import { updateSimClockFromRobotTime } from '../components/tasks/rmf-time';
import { useRmfApi } from './use-rmf-api';

/**
 * Keeps sim→wall clock offset fresh from fleet robot timestamps so task
 * start/finish display as real-world dates (not 1970 / sim T+…).
 */
export function SimClockSync(): null {
  const rmfApi = useRmfApi();
  const hadOffset = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    const subs: { unsubscribe: () => void }[] = [];

    const ingestFleet = (fleet: {
      robots?: Record<string, { unix_millis_time?: number | null }> | null;
    }) => {
      const robots = fleet.robots;
      if (!robots) return;
      let updated = false;
      for (const robot of Object.values(robots)) {
        if (robot.unix_millis_time != null) {
          updateSimClockFromRobotTime(robot.unix_millis_time);
          updated = true;
        }
      }
      // First successful sync: refresh tables so times redraw as wall clock.
      if (updated && !hadOffset.current) {
        hadOffset.current = true;
        AppEvents.refreshTaskApp.next();
        AppEvents.refreshRobotApp.next();
      }
    };

    const poll = async () => {
      try {
        const fleets = (await rmfApi.fleetsApi.getFleetsFleetsGet()).data;
        if (cancelled) return;
        for (const fleet of fleets) {
          ingestFleet(fleet);
          if (fleet.name) {
            subs.push(
              rmfApi.getFleetStateObs(fleet.name).subscribe((state) => {
                ingestFleet(state);
              }),
            );
          }
        }
      } catch (e) {
        console.debug('SimClockSync: fleet poll failed', e);
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const fleets = (await rmfApi.fleetsApi.getFleetsFleetsGet()).data;
          if (cancelled) return;
          for (const fleet of fleets) {
            ingestFleet(fleet);
          }
        } catch {
          /* ignore */
        }
      })();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      for (const s of subs) {
        s.unsubscribe();
      }
    };
  }, [rmfApi]);

  return null;
}
