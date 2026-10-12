import { Box, styled, Typography, useTheme } from '@mui/material';
import { Canvas, useLoader } from '@react-three/fiber';
import { AlertRequest, BuildingMap, FleetState, Level, Lift } from 'api-client';
import Debug from 'debug';
import React, { ChangeEvent, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Door as DoorModel } from 'rmf-models/ros/rmf_building_map_msgs/msg';
import { EMPTY, merge, scan, Subscription, switchMap, throttleTime } from 'rxjs';
import { Box3, TextureLoader, Vector3 } from 'three';

import {
  FleetResource,
  useAppController,
  useAuthenticator,
  useResources,
  useRmfApi,
} from '../../hooks';
import { ColorManager, TrajectoryData } from '../../services';
import { AppEvents } from '../app-events';
import { DoorSummary } from '../doors/door-summary';
import { LiftSummary } from '../lifts/lift-summary';
import { getPlaces, Place } from '../place';
import { RobotSummary } from '../robots/robot-summary';
import { RobotTableData } from '../robots/robot-table-datagrid';
import { CameraControl, FitCameraOnResize } from './camera-control';
import { Door } from './door-three';
import { ReactThreeFiberImageMaker } from './image-maker';
import { LayersController } from './layers-controller';
import { Lifts } from './lift-three';
import { NavGraphMaker } from './nav-graph-maker';
import { RobotThree } from './robot-three';
import { RobotData } from './robot-three-maker';
import { ShapeThreeRendering } from './shape-three-rendering';
import { TextThreeRendering } from './text-maker';
import { TrajectoryThree } from './trajectory-three';
import { computeFitZoom, findSceneBoundingBoxFromThreeFiber } from './utils';
import { WallMaker } from './wall-maker';

const debug = Debug('MapApp');

const TrajectoryUpdateInterval = 1000;
// schedule visualizer manages it's own settings so that it doesn't cause a re-render
// of the whole app when it changes.
const colorManager = new ColorManager();

const DEFAULT_ROBOT_SCALE = 0.002;

function getRobotId(fleetName: string, robotName: string): string {
  return `${fleetName}/${robotName}`;
}

export interface MapProps {
  defaultMapLevel: string;
  defaultZoom: number;
  defaultRobotZoom: number;
  attributionPrefix: string;
  /** Extra buttons in the robot-click summary (e.g. Drive teleop). */
  renderRobotSummaryActions?: (robot: RobotTableData) => React.ReactNode;
  /**
   * When set, robot clicks open this overlay instead of the blocking summary dialog.
   * Rendered as a sibling of the canvas (map stays interactive).
   * `location` is live RMF pose [x, y, yaw, map] when known.
   */
  renderRobotOverlay?: (
    robot: RobotTableData,
    onClose: () => void,
    location: [number, number, number, string] | null,
  ) => React.ReactNode;
}

export const Map = styled((props: MapProps) => {
  const theme = useTheme();
  // Match upstream rmf-web / RViz schedule markers (bright green path).
  const trajectoryColor = '#43a047';
  const authenticator = useAuthenticator();
  const { fleets: fleetResources } = useResources();
  const rmfApi = useRmfApi();
  const { showAlert } = useAppController();
  const [currentLevel, setCurrentLevel] = React.useState<Level | undefined>(undefined);
  const [disabledLayers, setDisabledLayers] = React.useState<Record<string, boolean>>({
    // Always hidden: only green schedule progress is drawn for paths.
    'Traffic lanes': true,
    Walls: false,
    'Pickup & Dropoff waypoints': false,
    'Pickup & Dropoff labels': true,
    Waypoints: false,
    'Waypoint labels': true,
    'Doors & Lifts': false,
    'Doors labels': true,
    Robots: false,
    'Robots labels': false,
    Trajectories: false,
  });
  const [openRobotSummary, setOpenRobotSummary] = React.useState(false);
  const [openDoorSummary, setOpenDoorSummary] = React.useState(false);
  const [openLiftSummary, setOpenLiftSummary] = React.useState(false);
  const [selectedRobot, setSelectedRobot] = React.useState<RobotTableData>();
  const [selectedDoor, setSelectedDoor] = React.useState<DoorModel>();
  const [selectedLift, setSelectedLift] = React.useState<Lift>();

  const renderRobotSummaryActions = props.renderRobotSummaryActions;
  const renderRobotOverlay = props.renderRobotOverlay;
  const useOverlay = Boolean(renderRobotOverlay);

  const [buildingMap, setBuildingMap] = React.useState<BuildingMap | null>(null);

  const [fleets, setFleets] = React.useState<FleetState[]>([]);

  const [waypoints, setWaypoints] = React.useState<Place[]>([]);
  const [currentLevelOfRobots, setCurrentLevelOfRobots] = React.useState<{
    [key: string]: string;
  }>({});

  // Seed robot levels from the REST fleet list so markers appear even before
  // the socket.io fleet-state stream connects.
  React.useEffect(() => {
    const next: Record<string, string> = {};
    for (const fleet of fleets) {
      if (!fleet.robots) continue;
      for (const [name, robot] of Object.entries(fleet.robots)) {
        if (robot.location?.map) {
          next[name] = robot.location.map;
        }
      }
    }
    if (Object.keys(next).length === 0) return;
    // Prefer fresh fleet data over stale level entries.
    setCurrentLevelOfRobots((prev) => ({ ...prev, ...next }));
  }, [fleets]);

  // Also seed positions from REST fleet snapshots and force a re-render.
  const { current: robotLocations } = React.useRef<
    Record<string, [number, number, number, string]>
  >({});
  const [locationEpoch, setLocationEpoch] = React.useState(0);
  React.useEffect(() => {
    let changed = false;
    for (const fleet of fleets) {
      if (!fleet.name || !fleet.robots) continue;
      for (const [robotName, robotState] of Object.entries(fleet.robots)) {
        if (!robotState.location) continue;
        const robotId = getRobotId(fleet.name, robotName);
        robotLocations[robotId] = [
          robotState.location.x,
          robotState.location.y,
          robotState.location.yaw,
          robotState.location.map,
        ];
        changed = true;
      }
    }
    if (changed) setLocationEpoch((n) => n + 1);
  }, [fleets, robotLocations]);

  const [trajectories, setTrajectories] = React.useState<TrajectoryData[]>([]);
  const trajectoryTime = 300000;
  const trajectoryAnimScale = trajectoryTime / (0.9 * TrajectoryUpdateInterval);
  const trajManager = rmfApi?.trajectoryManager;
  React.useEffect(() => {
    if (!currentLevel) {
      return;
    }

    let cancel = false;

    const updateTrajectory = async () => {
      debug('updating trajectories');

      if (cancel || !trajManager) return;

      try {
        const resp = await trajManager.latestTrajectory({
          request: 'trajectory',
          param: {
            map_name: currentLevel.name,
            duration: trajectoryTime,
            trim: true,
          },
          token: authenticator.token,
        });
        const flatConflicts = resp.conflicts.flatMap((c) => c);

        debug('set trajectories');
        const trajectories = resp.values.map((v) => ({
          trajectory: v,
          color: trajectoryColor,
          conflict: flatConflicts.includes(v.id),
          animationScale: trajectoryAnimScale,
          loopAnimation: false,
        }));

        // Drop bogus (0,0) origin knots only:
        // https://github.com/open-rmf/rmf_visualization/issues/65
        // Upstream used OR which also stripped real paths that cross x≈0 or y≈0.
        for (const t of trajectories) {
          while (t.trajectory.segments.length > 0) {
            const knot = t.trajectory.segments[0];
            if (Math.abs(knot.x[0]) < 1e-9 && Math.abs(knot.x[1]) < 1e-9) {
              t.trajectory.segments.shift();
            } else {
              break;
            }
          }
        }
        if (!cancel) {
          setTrajectories(trajectories.filter((t) => t.trajectory.segments.length >= 2));
        }
      } catch (e) {
        debug('trajectory update failed: %O', e);
      }
    };

    updateTrajectory();
    const interval = window.setInterval(updateTrajectory, TrajectoryUpdateInterval);
    debug(`created trajectory update interval ${interval}`);

    return () => {
      cancel = true;
      clearInterval(interval);
      debug(`cleared interval ${interval}`);
    };
  }, [
    trajManager,
    currentLevel,
    trajectoryTime,
    trajectoryAnimScale,
    authenticator.token,
    trajectoryColor,
  ]);

  React.useEffect(() => {
    const levelByName = (map: BuildingMap, levelName?: string) => {
      if (!levelName) {
        return null;
      }
      for (const l of map.levels) {
        if (l.name === levelName) {
          return l;
        }
      }
      return null;
    };

    const handleBuildingMap = (newMap: BuildingMap) => {
      setBuildingMap(newMap);
      const loggedInDisplayLevel = AppEvents.justLoggedIn.value
        ? levelByName(newMap, props.defaultMapLevel)
        : undefined;
      const currentLevel = loggedInDisplayLevel || AppEvents.levelSelect.value || newMap.levels[0];
      AppEvents.levelSelect.next(currentLevel);
      setWaypoints(
        getPlaces(newMap).filter((p) => p.level === currentLevel.name && p.vertex.name.length > 0),
      );
      AppEvents.justLoggedIn.next(false);
    };

    (async () => {
      try {
        const newMap = (await rmfApi.buildingApi.getBuildingMapBuildingMapGet()).data;
        handleBuildingMap(newMap);
      } catch (e) {
        console.log(`failed to get building map: ${(e as Error).message}`);
      }
    })();

    const subs: Subscription[] = [];
    subs.push(rmfApi.buildingMapObs.subscribe((newMap) => handleBuildingMap(newMap)));
    subs.push(rmfApi.fleetsObs.subscribe(setFleets));

    return () => {
      for (const sub of subs) {
        sub.unsubscribe();
      }
    };
  }, [rmfApi, props.defaultMapLevel]);

  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState<number>(props.defaultZoom);
  const [sceneBoundingBox, setSceneBoundingBox] = React.useState<Box3 | undefined>(undefined);
  const [distance, setDistance] = React.useState<number>(0);

  React.useEffect(() => {
    const subs: Subscription[] = [];
    subs.push(
      AppEvents.zoom.subscribe((currentValue) => {
        setZoom(currentValue || props.defaultZoom);
      }),
    );
    subs.push(
      AppEvents.levelSelect.subscribe((currentValue) => {
        const newSceneBoundingBox = currentValue
          ? findSceneBoundingBoxFromThreeFiber(currentValue)
          : undefined;
        if (newSceneBoundingBox) {
          const center = newSceneBoundingBox.getCenter(new Vector3());
          const size = newSceneBoundingBox.getSize(new Vector3());
          const distance = Math.max(size.x, size.y, size.z) * 0.7;
          const canvas = document.querySelector<HTMLCanvasElement>('.map-app-canvas');
          const newZoom =
            canvas && newSceneBoundingBox
              ? computeFitZoom(newSceneBoundingBox, canvas.clientWidth, canvas.clientHeight)
              : props.defaultZoom;
          AppEvents.resetCamera.next([center.x, center.y, center.z + distance, newZoom]);
          AppEvents.zoom.next(newZoom);
        }
        setCurrentLevel(currentValue ?? undefined);
        setSceneBoundingBox(newSceneBoundingBox);
      }),
    );
    return () => {
      for (const sub of subs) {
        sub.unsubscribe();
      }
    };
  }, [props.defaultZoom]);

  React.useEffect(() => {
    if (!currentLevel?.images[0]) {
      setImageUrl(null);
      return;
    }

    (async () => {
      useLoader.preload(TextureLoader, currentLevel.images[0].data);
      setImageUrl(currentLevel.images[0].data);
    })();

    buildingMap &&
      setWaypoints(
        getPlaces(buildingMap).filter(
          (p) => p.level === currentLevel.name && p.vertex.name.length > 0,
        ),
      );
  }, [buildingMap, currentLevel]);

  const [robots, setRobots] = React.useState<RobotData[]>([]);
  const { current: robotsStore } = React.useRef<Record<string, RobotData>>({});
  React.useEffect(() => {
    (async () => {
      if (!currentLevel) {
        return;
      }
      const promises = Object.values(fleets).flatMap((fleetState) => {
        if (!fleetState.name || !fleetState.robots) {
          return null;
        }
        const robotKey = Object.keys(fleetState.robots);
        const fleetName = fleetState.name;
        return robotKey.map(async (r) => {
          const robotId = getRobotId(fleetName, r);
          const fleetResource: FleetResource | undefined = fleetResources[fleetName];
          if (robotId in robotsStore) return;
          robotsStore[robotId] = {
            fleet: fleetName,
            name: r,
            // no model name
            model: '',
            scale: fleetResource?.default.scale || DEFAULT_ROBOT_SCALE,
            footprint: 0.3,
            color: await colorManager.robotPrimaryColor(fleetName, r, ''),
            // Prefer compact live dots over large fleet icon sprites.
            iconPath: undefined,
          };
        });
      });
      await Promise.all(promises);
      const newRobots = Object.values(fleets).flatMap((fleetState) => {
        const robotKey = fleetState.robots ? Object.keys(fleetState.robots) : [];
        return robotKey
          ?.filter(
            (r) =>
              fleetState.robots &&
              r in currentLevelOfRobots &&
              currentLevelOfRobots[r] === currentLevel.name &&
              `${fleetState.name}/${r}` in robotsStore,
          )
          .map((r) => robotsStore[`${fleetState.name}/${r}`]);
      });
      setRobots(newRobots);
    })();
  }, [fleets, fleetResources, robotsStore, currentLevel, currentLevelOfRobots, locationEpoch]);

  // updates the robot location from live fleet-state stream
  React.useEffect(() => {
    const sub = rmfApi.fleetsObs
      .pipe(
        switchMap((fleets) =>
          merge(
            ...fleets.map((f) =>
              f.name
                ? rmfApi
                    .getFleetStateObs(f.name)
                    .pipe(throttleTime(100, undefined, { leading: true, trailing: true }))
                : EMPTY,
            ),
          ),
        ),
      )
      .subscribe((fleetState) => {
        const fleetName = fleetState.name;
        if (!fleetName || !fleetState.robots) {
          console.warn('Map: Fail to update robot location (missing fleet name or robots)');
          return;
        }
        Object.entries(fleetState.robots).forEach(([robotName, robotState]) => {
          const robotId = getRobotId(fleetName, robotName);
          if (!robotState.location) {
            console.warn(`Map: Fail to update robot location for ${robotId} (missing location)`);
            return;
          }
          robotLocations[robotId] = [
            robotState.location.x,
            robotState.location.y,
            robotState.location.yaw,
            robotState.location.map,
          ];

          setCurrentLevelOfRobots((prevState) => {
            if (!robotState.location?.map) {
              if (robotName in prevState) {
                console.warn(`Map: Fail to update robot level for ${robotId} (missing map)`);
                const updatedState = { ...prevState };
                delete updatedState[robotName];
                return updatedState;
              }
              return prevState;
            }

            return {
              ...prevState,
              [robotName]: robotState.location.map,
            };
          });
          setLocationEpoch((n) => n + 1);
        });
      });
    return () => sub.unsubscribe();
  }, [rmfApi, robotLocations]);

  //Accumulate values over time to persist between tabs
  React.useEffect(() => {
    const sub = AppEvents.disabledLayers
      .pipe(scan((acc, value) => ({ ...acc, ...value }), {}))
      .subscribe((layers) => {
        setDisabledLayers(layers);
      });
    return () => sub.unsubscribe();
  }, []);

  // zoom to robot on select
  React.useEffect(() => {
    const subs: Subscription[] = [];

    // Centering on robot
    subs.push(
      AppEvents.robotSelect.subscribe((data) => {
        if (!data || !sceneBoundingBox) {
          return;
        }
        const [fleetName, robotName] = data;
        const robotId = getRobotId(fleetName, robotName);
        const robotLocation = robotLocations[robotId];
        if (!robotLocation) {
          console.warn(`Map: Failed to zoom to robot ${robotId} (robot location was not found)`);
          return;
        }

        const mapName = robotLocation[3];
        let newSceneBoundingBox = sceneBoundingBox;
        if (
          AppEvents.levelSelect.value &&
          AppEvents.levelSelect.value.name !== mapName &&
          buildingMap
        ) {
          const robotLevel =
            buildingMap.levels.find((l: Level) => l.name === mapName) || buildingMap.levels[0];
          AppEvents.levelSelect.next(robotLevel);

          const robotLevelSceneBoundingBox = findSceneBoundingBoxFromThreeFiber(robotLevel);
          if (!robotLevelSceneBoundingBox) {
            return;
          }
          newSceneBoundingBox = robotLevelSceneBoundingBox;
          setSceneBoundingBox(newSceneBoundingBox);
        }

        const size = newSceneBoundingBox.getSize(new Vector3());
        const distance = Math.max(size.x, size.y, size.z) * 0.7;
        const newZoom = props.defaultRobotZoom;
        AppEvents.resetCamera.next([
          robotLocation[0],
          robotLocation[1],
          robotLocation[2] + distance,
          newZoom,
        ]);
      }),
    );

    // Centering on door
    subs.push(
      AppEvents.doorSelect.subscribe((door) => {
        if (!door || !sceneBoundingBox) {
          return;
        }

        const [mapName, doorInfo] = door;

        let newSceneBoundingBox = sceneBoundingBox;
        if (
          AppEvents.levelSelect.value &&
          AppEvents.levelSelect.value.name !== mapName &&
          buildingMap
        ) {
          const doorLevel =
            buildingMap.levels.find((l: Level) => l.name === mapName) || buildingMap.levels[0];
          AppEvents.levelSelect.next(doorLevel);

          const doorLevelSceneBoundingBox = findSceneBoundingBoxFromThreeFiber(doorLevel);
          if (!doorLevelSceneBoundingBox) {
            return;
          }
          newSceneBoundingBox = doorLevelSceneBoundingBox;
          setSceneBoundingBox(newSceneBoundingBox);
        }

        const size = newSceneBoundingBox.getSize(new Vector3());
        const distance = Math.max(size.x, size.y, size.z) * 0.7;
        const newZoom = props.defaultRobotZoom;
        AppEvents.resetCamera.next([
          (doorInfo.v1_x + doorInfo.v2_x) / 2,
          (doorInfo.v1_y + doorInfo.v2_y) / 2,
          distance,
          newZoom,
        ]);
      }),
    );

    // Centering on lift
    subs.push(
      AppEvents.liftSelect.subscribe((lift) => {
        if (!lift || !sceneBoundingBox) {
          return;
        }

        const size = sceneBoundingBox.getSize(new Vector3());
        const distance = Math.max(size.x, size.y, size.z) * 0.7;
        const newZoom = props.defaultRobotZoom;
        AppEvents.resetCamera.next([lift.ref_x, lift.ref_y, distance, newZoom]);
      }),
    );

    return () => {
      for (const sub of subs) {
        sub.unsubscribe();
      }
    };
  }, [robotLocations, sceneBoundingBox, buildingMap, props.defaultRobotZoom]);

  React.useEffect(() => {
    if (!sceneBoundingBox) {
      return;
    }

    const size = sceneBoundingBox.getSize(new Vector3());
    setDistance(Math.max(size.x, size.y, size.z) * 0.7);
  }, [sceneBoundingBox]);

  return buildingMap && currentLevel ? (
    <Suspense fallback={null}>
      <LayersController
        disabledLayers={disabledLayers}
        levels={buildingMap.levels}
        currentLevel={currentLevel}
        onChange={(_event: ChangeEvent<HTMLInputElement>, value: string) => {
          AppEvents.levelSelect.next(
            buildingMap.levels.find((l: Level) => l.name === value) || buildingMap.levels[0],
          );
        }}
        handleFullView={() => {
          if (!sceneBoundingBox) {
            return;
          }
          const center = sceneBoundingBox.getCenter(new Vector3());
          const size = sceneBoundingBox.getSize(new Vector3());
          const distance = Math.max(size.x, size.y, size.z) * 0.7;
          const canvas = document.querySelector<HTMLCanvasElement>('.map-app-canvas');
          const newZoom = canvas
            ? computeFitZoom(sceneBoundingBox, canvas.clientWidth, canvas.clientHeight)
            : props.defaultZoom;
          AppEvents.resetCamera.next([center.x, center.y, center.z + distance, newZoom]);
          AppEvents.zoom.next(newZoom);
        }}
        handleZoomIn={() => AppEvents.zoomIn.next()}
        handleZoomOut={() => AppEvents.zoomOut.next()}
      />
      {props.attributionPrefix ? (
        <Box
          sx={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            width: 'auto',
            height: 'auto',
            zIndex: '1',
          }}
        >
          <Typography variant="caption" display="block">
            {props.attributionPrefix}
          </Typography>
        </Box>
      ) : null}
      <Canvas
        className="map-app-canvas"
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ camera, size }) => {
          let sceneBoundingBoxToUse = sceneBoundingBox;
          if (!sceneBoundingBoxToUse && currentLevel) {
            sceneBoundingBoxToUse = findSceneBoundingBoxFromThreeFiber(currentLevel);
          }
          if (!sceneBoundingBoxToUse) {
            const alertRequest: AlertRequest = {
              id: `scene-bounding-${new Date().toLocaleTimeString()}`,
              unix_millis_alert_time: new Date().getTime(),
              title: 'Map rendering error',
              subtitle: 'Missing walls or navigation graphs in Building Map',
              message:
                'Please verify that the Building Map contains valid walls and navigation graphs, for the map to be displayed properly. Falling back to a generic scale.',
              display: true,
              tier: 'warning',
              responses_available: [],
              alert_parameters: [],
              task_id: null,
            };
            AppEvents.pushAlert.next(alertRequest);
            sceneBoundingBoxToUse = new Box3(new Vector3(-10, -10, 0), new Vector3(10, 10, 10));
          }
          const center = sceneBoundingBoxToUse.getCenter(new Vector3());
          const bboxSize = sceneBoundingBoxToUse.getSize(new Vector3());
          const camDistance = Math.max(bboxSize.x, bboxSize.y, bboxSize.z) * 0.7;
          const fitZoom = computeFitZoom(sceneBoundingBoxToUse, size.width, size.height);
          camera.position.set(center.x, center.y, center.z + camDistance);
          camera.zoom = fitZoom;
          camera.updateProjectionMatrix();
          AppEvents.zoom.next(fitZoom);
        }}
        orthographic={true}
      >
        <CameraControl zoom={zoom} />
        {sceneBoundingBox && <FitCameraOnResize sceneBoundingBox={sceneBoundingBox} />}
        {!disabledLayers['Traffic lanes'] && currentLevel.nav_graphs?.length > 0 && (
          <NavGraphMaker graphs={currentLevel.nav_graphs} />
        )}
        {!disabledLayers['Walls'] && currentLevel.wall_graph && (
          <WallMaker wallGraph={currentLevel.wall_graph} />
        )}
        {!disabledLayers['Pickup & Dropoff waypoints'] &&
          waypoints
            .filter((waypoint) => waypoint.pickupHandler || waypoint.dropoffHandler)
            .map((place, index) => (
              <ShapeThreeRendering
                key={index}
                position={[place.vertex.x, place.vertex.y, 0]}
                color="yellow"
                text={place.vertex.name}
                circleShape={false}
              />
            ))}
        {!disabledLayers['Pickup & Dropoff labels'] &&
          waypoints
            .filter((waypoint) => waypoint.pickupHandler || waypoint.dropoffHandler)
            .map((place, index) => (
              <TextThreeRendering
                key={index}
                position={[place.vertex.x, place.vertex.y, 0]}
                text={place.vertex.name}
              />
            ))}
        {!disabledLayers['Waypoints'] &&
          waypoints
            .filter((waypoint) => !waypoint.pickupHandler && !waypoint.dropoffHandler)
            .map((place, index) => (
              <ShapeThreeRendering
                key={index}
                position={[place.vertex.x, place.vertex.y, 0]}
                color="yellow"
                text={place.vertex.name}
                circleShape={false}
              />
            ))}
        {!disabledLayers['Waypoint labels'] &&
          waypoints
            .filter((waypoint) => !waypoint.pickupHandler && !waypoint.dropoffHandler)
            .map((place, index) => (
              <TextThreeRendering
                key={index}
                position={[place.vertex.x, place.vertex.y, 0]}
                text={place.vertex.name}
              />
            ))}
        {buildingMap.lifts.length > 0
          ? buildingMap.lifts.map((lift) =>
              lift.doors.map((door, i) => (
                <React.Fragment key={`${door.name}${i}`}>
                  {!disabledLayers['Doors labels'] && (
                    <TextThreeRendering position={[door.v1_x, door.v1_y, 0]} text={door.name} />
                  )}
                  {!disabledLayers['Doors & Lifts'] && (
                    <Door
                      door={door}
                      opacity={0.1}
                      height={8}
                      elevation={currentLevel.elevation}
                      lift={lift}
                      onDoorClick={(_ev) => {
                        setOpenLiftSummary(true);
                        setSelectedLift(lift);
                      }}
                    />
                  )}
                </React.Fragment>
              )),
            )
          : null}
        {!disabledLayers['Doors & Lifts'] && buildingMap.lifts.length > 0
          ? buildingMap.lifts.map((lift) =>
              lift.doors.map(() => (
                <Lifts
                  key={lift.name}
                  lift={lift}
                  height={8}
                  elevation={currentLevel.elevation}
                  opacity={0.1}
                  onLiftClick={(_ev, lift) => {
                    setOpenLiftSummary(true);
                    setSelectedLift(lift);
                  }}
                />
              )),
            )
          : null}
        {currentLevel.doors.length > 0
          ? currentLevel.doors.map((door, i) => (
              <React.Fragment key={`${door.name}${i}`}>
                {!disabledLayers['Doors labels'] && (
                  <TextThreeRendering position={[door.v1_x, door.v1_y, 0]} text={door.name} />
                )}
                {!disabledLayers['Doors'] && (
                  <Door
                    door={door}
                    opacity={0.1}
                    height={8}
                    elevation={currentLevel.elevation}
                    onDoorClick={(_ev, door) => {
                      setOpenDoorSummary(true);
                      setSelectedDoor(door);
                    }}
                  />
                )}
              </React.Fragment>
            ))
          : null}
        {currentLevel.images.length > 0 && imageUrl && (
          <ErrorBoundary
            fallback={<></>}
            onError={(error, info) => {
              console.error(error);
              console.log(info);
              showAlert(
                'error',
                'Unable to retrieve building map images. Please ensure that the building map server is operational and without issues.',
                20000,
              );
            }}
          >
            <ReactThreeFiberImageMaker level={currentLevel} imageUrl={imageUrl} />
          </ErrorBoundary>
        )}
        {!disabledLayers['Robots'] &&
          robots.map((robot) => {
            const robotId = `${robot.fleet}/${robot.name}`;
            if (robotId in robotLocations) {
              const location = robotLocations[robotId];
              const position: [number, number, number] = [location[0], location[1], location[2]];
              return (
                <RobotThree
                  key={`${robot.name} ${robot.fleet}`}
                  robot={robot}
                  robotLocation={position}
                  onRobotClick={(_ev, robot) => {
                    setSelectedRobot(robot);
                    if (!useOverlay) {
                      setOpenRobotSummary(true);
                    } else {
                      setOpenRobotSummary(false);
                    }
                  }}
                  robotLabel={!disabledLayers['Robots labels']}
                />
              );
            }
            return null;
          })}
        {!disabledLayers['Trajectories'] &&
          trajectories.map((trajData) => (
            <TrajectoryThree
              key={`${trajData.trajectory.fleet_name}/${trajData.trajectory.robot_name}/${trajData.trajectory.id}`}
              trajData={trajData}
            />
          ))}
        <ambientLight />
      </Canvas>
      {useOverlay && selectedRobot && (() => {
        // Re-render dock when RMF pose updates (robotLocations is a mutable ref).
        void locationEpoch;
        const rid = `${selectedRobot.fleet}/${selectedRobot.name}`;
        const loc = robotLocations[rid] ?? null;
        return renderRobotOverlay?.(
          selectedRobot,
          () => setSelectedRobot(undefined),
          loc,
        );
      })()}
      {!useOverlay && openRobotSummary && selectedRobot && (
        <RobotSummary
          robot={selectedRobot}
          onClose={() => setOpenRobotSummary(false)}
          extraActions={renderRobotSummaryActions?.(selectedRobot)}
        />
      )}
      {openDoorSummary && selectedDoor && (
        <DoorSummary
          onClose={() => setOpenDoorSummary(false)}
          door={selectedDoor}
          doorLevelName={currentLevel.name}
        />
      )}

      {openLiftSummary && selectedLift && (
        <LiftSummary onClose={() => setOpenLiftSummary(false)} lift={selectedLift} />
      )}
    </Suspense>
  ) : null;
})({
  position: 'relative',
  width: '100%',
  height: '100%',
  display: 'block',
  overflow: 'hidden',
  // This ensures that the resize handle is above the map.
  '& > .react-resizable-handle': {
    zIndex: 1001,
  },
  '& canvas': {
    display: 'block',
  },
});

export default Map;
