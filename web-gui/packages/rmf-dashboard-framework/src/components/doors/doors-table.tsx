import { TableContainer } from '@mui/material';
import { BuildingMap } from 'api-client';
import React from 'react';
import { DoorMode as RmfDoorMode } from 'rmf-models/ros/rmf_door_msgs/msg/DoorMode';
import { throttleTime } from 'rxjs';

import { useRmfApi } from '../../hooks';
import { AppEvents } from '../app-events';
import { DoorDataGridTable, DoorTableData } from './door-table-datagrid';

export const DoorsTable = () => {
  const rmfApi = useRmfApi();
  const [buildingMap, setBuildingMap] = React.useState<BuildingMap | null>(null);
  const [doorTableData, setDoorTableData] = React.useState<Record<string, DoorTableData>>({});

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = (await rmfApi.buildingApi.getBuildingMapBuildingMapGet()).data;
        if (!cancelled) setBuildingMap(map);
      } catch (error) {
        console.error('DoorsTable: failed to fetch building map', error);
      }
    })();
    const sub = rmfApi.buildingMapObs.subscribe(setBuildingMap);
    return () => {
      cancelled = true;
      sub.unsubscribe();
    };
  }, [rmfApi]);

  React.useEffect(() => {
    if (!buildingMap) {
      return;
    }

    const unsubs: Array<() => void> = [];
    for (const level of buildingMap.levels) {
      for (const door of level.doors) {
        // Show the door immediately; fill mode when state arrives.
        setDoorTableData((prev) => {
          if (prev[door.name]) return prev;
          return {
            ...prev,
            [door.name]: {
              index: Object.keys(prev).length,
              doorName: door.name,
              levelName: level.name,
              doorType: door.door_type,
              onClickOpen: () =>
                rmfApi.doorsApi.postDoorRequestDoorsDoorNameRequestPost(door.name, {
                  mode: RmfDoorMode.MODE_OPEN,
                }),
              onClickClose: () =>
                rmfApi.doorsApi.postDoorRequestDoorsDoorNameRequestPost(door.name, {
                  mode: RmfDoorMode.MODE_CLOSED,
                }),
            },
          };
        });

        const sub = rmfApi
          .getDoorStateObs(door.name)
          .pipe(throttleTime(3000, undefined, { leading: true, trailing: true }))
          .subscribe((doorState) => {
            setDoorTableData((prev) => ({
              ...prev,
              [door.name]: {
                ...(prev[door.name] ?? {
                  index: Object.keys(prev).length,
                  doorName: door.name,
                  levelName: level.name,
                  doorType: door.door_type,
                  onClickOpen: () =>
                    rmfApi.doorsApi.postDoorRequestDoorsDoorNameRequestPost(door.name, {
                      mode: RmfDoorMode.MODE_OPEN,
                    }),
                  onClickClose: () =>
                    rmfApi.doorsApi.postDoorRequestDoorsDoorNameRequestPost(door.name, {
                      mode: RmfDoorMode.MODE_CLOSED,
                    }),
                }),
                doorState,
              },
            }));
          });
        unsubs.push(() => sub.unsubscribe());
      }
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [rmfApi, buildingMap]);

  return (
    <TableContainer sx={{ height: '100% ' }}>
      <DoorDataGridTable
        doors={Object.values(doorTableData)}
        onDoorClick={(_ev, doorData) => {
          if (!buildingMap) {
            AppEvents.doorSelect.next(null);
            return;
          }

          for (const level of buildingMap.levels) {
            for (const door of level.doors) {
              if (door.name === doorData.doorName) {
                AppEvents.doorSelect.next([level.name, door]);
                return;
              }
            }
          }
        }}
      />
    </TableContainer>
  );
};

export default DoorsTable;
