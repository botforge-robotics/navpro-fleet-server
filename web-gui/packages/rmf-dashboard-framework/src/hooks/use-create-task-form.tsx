import React from 'react';
import { Subscription } from 'rxjs';

import { getPlaces } from '../components/place';
import { RmfApi } from '../services';

function applyBuildingMapPlaces(
  map: Parameters<typeof getPlaces>[0],
  setters: {
    setWaypointNames: (v: string[]) => void;
    setPickupPoints: (v: Record<string, string>) => void;
    setDropoffPoints: (v: Record<string, string>) => void;
    setCleaningZoneNames: (v: string[]) => void;
  },
) {
  const places = getPlaces(map);
  const waypointNames: string[] = [];
  const pickupPoints: Record<string, string> = {};
  const dropoffPoints: Record<string, string> = {};
  const cleaningZoneNames: string[] = [];
  for (const p of places) {
    if (p.pickupHandler !== undefined && p.pickupHandler.length !== 0) {
      pickupPoints[p.vertex.name] = p.pickupHandler;
    }
    if (p.dropoffHandler !== undefined && p.dropoffHandler.length !== 0) {
      dropoffPoints[p.vertex.name] = p.dropoffHandler;
    }
    if (p.cleaningZone !== undefined && p.cleaningZone === true) {
      cleaningZoneNames.push(p.vertex.name);
    }
    waypointNames.push(p.vertex.name);
  }

  setters.setPickupPoints(pickupPoints);
  setters.setDropoffPoints(dropoffPoints);
  setters.setCleaningZoneNames(cleaningZoneNames);
  setters.setWaypointNames(waypointNames);
}

export const useTaskFormData = (rmfApi: RmfApi | undefined) => {
  const [waypointNames, setWaypointNames] = React.useState<string[]>([]);
  const [cleaningZoneNames, setCleaningZoneNames] = React.useState<string[]>([]);
  const [pickupPoints, setPickupPoints] = React.useState<Record<string, string>>({});
  const [dropoffPoints, setDropoffPoints] = React.useState<Record<string, string>>({});
  const [fleets, setFleets] = React.useState<Record<string, string[]>>({});

  React.useEffect(() => {
    if (!rmfApi) {
      return;
    }

    const placeSetters = {
      setWaypointNames,
      setPickupPoints,
      setDropoffPoints,
      setCleaningZoneNames,
    };

    // Seed from REST so place lists work even if socket.io / buildingMapObs fails.
    let cancelled = false;
    (async () => {
      try {
        const map = (await rmfApi.buildingApi.getBuildingMapBuildingMapGet()).data;
        if (!cancelled) applyBuildingMapPlaces(map, placeSetters);
      } catch (error) {
        console.error('useTaskFormData: failed to fetch building map', error);
      }
    })();

    const subs: Subscription[] = [];
    subs.push(
      rmfApi.buildingMapObs.subscribe((map) => {
        applyBuildingMapPlaces(map, placeSetters);
      }),
    );
    subs.push(
      rmfApi.fleetsObs.subscribe((fleetStates) => {
        const result: Record<string, string[]> = {};
        for (const fleet of fleetStates) {
          if (!fleet.name || !fleet.robots) {
            continue;
          }
          result[fleet.name] = Object.keys(fleet.robots);
        }
        setFleets(result);
      }),
    );

    return () => {
      cancelled = true;
      subs.forEach((s) => s.unsubscribe());
    };
  }, [rmfApi]);

  return { waypointNames, pickupPoints, dropoffPoints, cleaningZoneNames, fleets };
};
