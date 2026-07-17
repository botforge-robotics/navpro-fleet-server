import {
  AccountCircle,
  AdminPanelSettings,
  Brightness4 as Brightness4Icon,
  Brightness7 as Brightness7Icon,
  LocalFireDepartment,
  Logout,
  Notifications,
  Report,
} from '@mui/icons-material';
import {
  AppBar as MuiAppBar,
  Badge,
  Box,
  Button,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AlertRequest, FireAlarmTriggerState, TaskFavorite } from 'api-client';
import { formatDistance } from 'date-fns';
import React from 'react';
import { Subscription } from 'rxjs';

import {
  useAppController,
  useAuthenticator,
  useResources,
  useRmfApi,
  useSettings,
  useTaskFormData,
  useTaskRegistry,
  useUserProfile,
} from '../hooks';
import { AppEvents } from './app-events';
import { ConfirmationDialog } from './confirmation-dialog';
import { dispatchTask, scheduleTask, TaskForm, TaskFormProps } from './tasks';
import { DashboardThemes } from './theme';

export const APP_BAR_HEIGHT = '3.5rem';

const ToolbarIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof IconButton>
>((props, ref) => <IconButton size="large" ref={ref} {...props} />);

function AppSettings() {
  const settings = useSettings();
  const appController = useAppController();
  return (
    <FormControl>
      <FormLabel id="theme-label">Theme</FormLabel>
      <RadioGroup row aria-labelledby="theme-label">
        <FormControlLabel
          value={'default'}
          control={<Radio />}
          label="Default"
          checked={settings.themeMode === 'default'}
          onChange={() => appController.updateSettings({ ...settings, themeMode: 'default' })}
        />
      </RadioGroup>
    </FormControl>
  );
}

export interface AppBarProps {
  tabs: React.ReactElement<React.ComponentProps<typeof Tab>>[];
  tabValue: string;
  themes?: DashboardThemes;
  extraToolbarItems?: React.ReactNode;
}

export const AppBar = React.memo(
  ({ tabs, tabValue, themes, extraToolbarItems }: AppBarProps) => {
    const authenticator = useAuthenticator();
    const rmfApi = useRmfApi();
    const resources = useResources();
    const taskRegistry = useTaskRegistry();
    const { showAlert } = useAppController();
    const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
    const profile = useUserProfile();
    const [settingsAnchor, setSettingsAnchor] = React.useState<HTMLElement | null>(null);
    const [openCreateTaskForm, setOpenCreateTaskForm] = React.useState(false);
    const [favoritesTasks, setFavoritesTasks] = React.useState<TaskFavorite[]>([]);
    const [alertListAnchor, setAlertListAnchor] = React.useState<HTMLElement | null>(null);
    const [unacknowledgedAlertList, setUnacknowledgedAlertList] = React.useState<AlertRequest[]>(
      [],
    );
    const [openAdminActionsDialog, setOpenAdminActionsDialog] = React.useState(false);
    const [openFireAlarmTriggerResetDialog, setOpenFireAlarmTriggerResetDialog] =
      React.useState(false);
    const [fireAlarmPreviousTrigger, setFireAlarmPreviousTrigger] = React.useState<
      FireAlarmTriggerState | undefined
    >(undefined);

    const { waypointNames, pickupPoints, dropoffPoints, cleaningZoneNames, fleets } =
      useTaskFormData(rmfApi);
    const username = profile.user.username;

    async function handleLogout(): Promise<void> {
      try {
        await authenticator.logout();
      } catch (e) {
        console.error(`error logging out: ${(e as Error).message}`);
      }
    }

    React.useEffect(() => {
      const updateUnrespondedAlerts = async () => {
        const { data: alerts } =
          await rmfApi.alertsApi.getUnrespondedAlertsAlertsUnrespondedRequestsGet();
        // alert.display is checked to verify that the dashboard should display it
        // in the first place
        const alertsToBeDisplayed = alerts.filter((alert) => alert.display);
        setUnacknowledgedAlertList(alertsToBeDisplayed.reverse());
      };

      const subs: Subscription[] = [];
      subs.push(rmfApi.alertRequestsObsStore.subscribe(updateUnrespondedAlerts));
      subs.push(rmfApi.alertResponsesObsStore.subscribe(updateUnrespondedAlerts));

      // Get the initial number of unacknowledged alerts
      updateUnrespondedAlerts();
      return () => subs.forEach((s) => s.unsubscribe());
    }, [rmfApi]);

    const dispatchTaskCallback = React.useCallback<Required<TaskFormProps>['onDispatchTask']>(
      async (taskRequest, robotDispatchTarget) => {
        if (!rmfApi) {
          throw new Error('tasks api not available');
        }
        await dispatchTask(rmfApi, taskRequest, robotDispatchTarget);
        AppEvents.refreshTaskApp.next();
      },
      [rmfApi],
    );

    const scheduleTaskCallback = React.useCallback<Required<TaskFormProps>['onScheduleTask']>(
      async (taskRequest, schedule) => {
        if (!rmfApi) {
          throw new Error('tasks api not available');
        }
        await scheduleTask(rmfApi, taskRequest, schedule);
        AppEvents.refreshTaskApp.next();
      },
      [rmfApi],
    );

    //#region 'Favorite Task'
    React.useEffect(() => {
      const getFavoriteTasks = async () => {
        const resp = await rmfApi.tasksApi.getFavoritesTasksFavoriteTasksGet();
        const results = resp.data as TaskFavorite[];
        setFavoritesTasks(results);
      };
      getFavoriteTasks();

      const sub = AppEvents.refreshFavoriteTasks.subscribe({ next: getFavoriteTasks });
      return () => sub.unsubscribe();
    }, [rmfApi]);

    const submitFavoriteTask = React.useCallback<Required<TaskFormProps>['submitFavoriteTask']>(
      async (taskFavoriteRequest) => {
        await rmfApi.tasksApi.postFavoriteTaskFavoriteTasksPost(taskFavoriteRequest);
        AppEvents.refreshFavoriteTasks.next();
      },
      [rmfApi],
    );

    const deleteFavoriteTask = React.useCallback<Required<TaskFormProps>['deleteFavoriteTask']>(
      async (favoriteTask) => {
        if (!favoriteTask.id) {
          throw new Error('Id is needed');
        }

        await rmfApi.tasksApi.deleteFavoriteTaskFavoriteTasksFavoriteTaskIdDelete(favoriteTask.id);
        AppEvents.refreshFavoriteTasks.next();
      },
      [rmfApi],
    );
    //#endregion 'Favorite Task'

    const handleOpenAlertList = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      setAlertListAnchor(event.currentTarget);
    };

    const openAlertDialog = (alert: AlertRequest) => {
      AppEvents.pushAlert.next(alert);
    };

    const timeDistance = (time: number) => {
      return formatDistance(new Date(), new Date(time));
    };

    React.useEffect(() => {
      (async () => {
        try {
          const resp =
            await rmfApi.buildingApi.getPreviousFireAlarmTriggerBuildingMapPreviousFireAlarmTriggerGet();
          setFireAlarmPreviousTrigger(resp.data);
        } catch (e) {
          console.error(`Failed to get previous fire alarm trigger: ${(e as Error).message}`);
        }
      })();
    }, [rmfApi, openAdminActionsDialog]);

    const handleResetFireAlarmTrigger = React.useCallback<React.MouseEventHandler>(async () => {
      try {
        const resp =
          await rmfApi.buildingApi.resetFireAlarmTriggerBuildingMapResetFireAlarmTriggerPost();
        if (!resp.data.trigger) {
          showAlert('success', 'Requested to reset fire alarm trigger');
        } else {
          showAlert('error', 'Failed to reset fire alarm trigger');
        }
      } catch (e) {
        showAlert('error', `Failed to reset fire alarm trigger: ${(e as Error).message}`);
      }

      setOpenFireAlarmTriggerResetDialog(false);
      setOpenAdminActionsDialog(false);
    }, [rmfApi, showAlert]);

    const theme = useTheme();
    const settings = useSettings();
    const appController = useAppController();

    return (
      <MuiAppBar
        position="sticky"
        sx={{
          height: APP_BAR_HEIGHT,
          zIndex: theme.zIndex.drawer + 1,
          bgcolor: (t) => alpha(t.palette.background.paper, 0.86),
          borderBottom: (t) => `1px solid ${t.palette.divider}`,
          boxShadow: 'none',
          backdropFilter: 'blur(20px) saturate(1.25)',
        }}
      >
        <Grid container alignItems="center" justifyContent="space-between" wrap="nowrap">
          <Box display="flex" alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2.5,
                height: APP_BAR_HEIGHT,
                flexShrink: 0,
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: `${theme.shape.borderRadius * 0.67}px`,
                  background: (t) =>
                    `linear-gradient(145deg, ${t.palette.primary.light}, ${t.palette.primary.dark})`,
                  boxShadow: (t) =>
                    `0 0 0 1px ${alpha(t.palette.primary.light, 0.3)}, 0 4px 12px ${alpha(t.palette.primary.main, 0.35)}`,
                  position: 'relative',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: '22%',
                    top: '30%',
                    width: '56%',
                    height: '11%',
                    borderRadius: 999,
                    bgcolor: 'primary.contrastText',
                    opacity: 0.95,
                  },
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    left: '22%',
                    top: '50%',
                    width: '34%',
                    height: '11%',
                    borderRadius: 999,
                    bgcolor: 'primary.contrastText',
                    opacity: 0.55,
                  },
                }}
              />
              <Box sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1.15 }}>
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 700, letterSpacing: '-0.03em', color: 'text.primary' }}
                >
                  NavPro
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', letterSpacing: '0.06em', textTransform: 'uppercase' }}
                >
                  Fleet
                </Typography>
              </Box>
              {/* Keep logo resource wired for compatibility; mark is the visible brand. */}
              <img
                src={resources.logos.header}
                alt=""
                aria-hidden
                style={{ display: 'none' }}
              />
            </Box>
            <Divider orientation="vertical" flexItem sx={{ opacity: 0.5, my: 1.25 }} />
            <Tabs
              variant="scrollable"
              value={tabValue}
              textColor="inherit"
              indicatorColor="primary"
              sx={{ minHeight: APP_BAR_HEIGHT, flex: 1, ml: 0.5 }}
            >
              {tabs}
            </Tabs>
          </Box>
          <Toolbar variant="dense" sx={{ flexShrink: 0, gap: 0.75, pr: 1.5 }}>
            <Box display="flex" alignItems="center" gap={1.25}>
              <Button
                id="create-new-task-button"
                aria-label="new task"
                color="primary"
                variant="contained"
                size="small"
                sx={{ mr: 0.5, px: 2.25, minHeight: 36 }}
                onClick={() => setOpenCreateTaskForm(true)}
              >
                New Task
              </Button>
            </Box>
            <Divider orientation="vertical" flexItem sx={{ opacity: 0.5, my: 1.25 }} />
            <Tooltip title="Notifications">
              <ToolbarIconButton
                id="alert-list-button"
                aria-label="alert-list-button"
                color="inherit"
                onClick={handleOpenAlertList}
              >
                <Badge badgeContent={unacknowledgedAlertList.length} color="secondary">
                  <Notifications fontSize="inherit" />
                </Badge>
              </ToolbarIconButton>
            </Tooltip>
            <Menu
              anchorEl={alertListAnchor}
              open={!!alertListAnchor}
              onClose={() => setAlertListAnchor(null)}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
              slotProps={{
                paper: {
                  style: {
                    maxHeight: '20rem',
                    maxWidth: '30rem',
                  },
                },
              }}
            >
              {unacknowledgedAlertList.length === 0 ? (
                <MenuItem dense disabled>
                  <Typography variant="body2" noWrap>
                    No unacknowledged alerts
                  </Typography>
                </MenuItem>
              ) : (
                unacknowledgedAlertList.map((alert) => (
                  <Tooltip
                    key={alert.id}
                    title={
                      <>
                        <Typography>Alert</Typography>
                        <Typography>ID: {alert.id}</Typography>
                        <Typography>Title: {alert.title}</Typography>
                        <Typography>
                          Created: {new Date(alert.unix_millis_alert_time).toLocaleString()}
                        </Typography>
                      </>
                    }
                    placement="right"
                  >
                    <MenuItem
                      dense
                      onClick={() => {
                        openAlertDialog(alert);
                        setAlertListAnchor(null);
                      }}
                      divider
                    >
                      <Report />
                      <Typography variant="body2" mx={1} noWrap>
                        {alert.task_id ? `Task ${alert.task_id} had an alert ` : 'Alert occured '}
                        {timeDistance(alert.unix_millis_alert_time)} ago
                      </Typography>
                    </MenuItem>
                  </Tooltip>
                ))
              )}
            </Menu>
            {extraToolbarItems}
            {themes?.dark && (
              <Tooltip title="Toggle Dark Mode">
                <ToolbarIconButton
                  id="toggle-dark-mode-btn"
                  aria-label="toggle dark mode"
                  color="inherit"
                  onClick={() =>
                    appController.updateSettings({
                      ...settings,
                      themeMode: settings.themeMode === 'default' ? 'dark' : 'default',
                    })
                  }
                >
                  {settings.themeMode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
                </ToolbarIconButton>
              </Tooltip>
            )}
            <Tooltip title="Profile">
              <ToolbarIconButton
                id="user-btn"
                aria-label={'user-btn'}
                color="inherit"
                onClick={(event) => setAnchorEl(event.currentTarget)}
              >
                <AccountCircle />
              </ToolbarIconButton>
            </Tooltip>
            <Menu
              anchorEl={anchorEl}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              open={!!anchorEl}
              onClose={() => setAnchorEl(null)}
            >
              <MenuItem disabled>
                <ListItemText>{`Logged in as ${username ?? 'unknown user'}`}</ListItemText>
                <Divider orientation="vertical" sx={{ marginLeft: 1, marginRight: 2 }} />
                <ListItemIcon>
                  <Chip
                    color="primary"
                    size="small"
                    label={profile.user.is_admin ? 'Admin' : 'User'}
                  />
                </ListItemIcon>
              </MenuItem>
              <Divider />
              <MenuItem
                disabled={!profile.user.is_admin}
                id="admin-action-btn"
                onClick={() => {
                  setOpenAdminActionsDialog(true);
                  setAnchorEl(null);
                }}
              >
                <ListItemIcon>
                  <AdminPanelSettings fontSize="small" />
                </ListItemIcon>
                Admin actions
              </MenuItem>
              <Divider />
              <MenuItem id="logout-btn" onClick={handleLogout}>
                <ListItemIcon>
                  <Logout fontSize="small" />
                </ListItemIcon>
                Logout
              </MenuItem>
            </Menu>
          </Toolbar>
        </Grid>

        <Menu
          anchorEl={settingsAnchor}
          open={!!settingsAnchor}
          onClose={() => setSettingsAnchor(null)}
        >
          <CardContent>
            <AppSettings />
          </CardContent>
        </Menu>

        {openCreateTaskForm && (
          <TaskForm
            user={username ? username : 'unknown user'}
            fleets={fleets}
            tasksToDisplay={taskRegistry.taskDefinitions}
            patrolWaypoints={waypointNames}
            cleaningZones={cleaningZoneNames}
            pickupZones={taskRegistry.pickupZones}
            cartIds={taskRegistry.cartIds}
            pickupPoints={pickupPoints}
            dropoffPoints={dropoffPoints}
            favoritesTasks={favoritesTasks}
            open={openCreateTaskForm}
            onClose={() => setOpenCreateTaskForm(false)}
            onDispatchTask={dispatchTaskCallback}
            onScheduleTask={scheduleTaskCallback}
            onEditScheduleTask={undefined}
            submitFavoriteTask={submitFavoriteTask}
            deleteFavoriteTask={deleteFavoriteTask}
            onSuccess={() => {
              console.log('Dispatch task requested');
              setOpenCreateTaskForm(false);
              showAlert('success', 'Dispatch task requested');
            }}
            onFail={(e) => {
              console.error(`Failed to dispatch task: ${e.message}`);
              showAlert('error', `Failed to dispatch task: ${e.message}`);
            }}
            onSuccessFavoriteTask={(message) => {
              console.log(`Created favorite task: ${message}`);
              showAlert('success', message);
            }}
            onFailFavoriteTask={(e) => {
              console.error(`Failed to create favorite task: ${e.message}`);
              showAlert('error', `Failed to create or delete favorite task: ${e.message}`);
            }}
            onSuccessScheduling={() => {
              console.log('Create schedule requested');
              setOpenCreateTaskForm(false);
              showAlert('success', 'Create schedule requested');
            }}
            onFailScheduling={(e) => {
              console.error(`Failed to create schedule: ${e.message}`);
              showAlert('error', `Failed to submit schedule: ${e.message}`);
            }}
          />
        )}

        {openAdminActionsDialog && (
          <Dialog onClose={() => setOpenAdminActionsDialog(false)} open={openAdminActionsDialog}>
            <DialogTitle>Admin actions</DialogTitle>
            <DialogActions sx={{ px: 2 }}>
              <Stack direction="column" spacing={2}>
                <Stack direction="row" spacing={2}>
                  {fireAlarmPreviousTrigger && fireAlarmPreviousTrigger.trigger ? (
                    <div>
                      <Typography variant="subtitle2" alignContent="center">
                        Last fire alarm triggered on:
                      </Typography>
                      <Typography variant="body2" alignContent="center">
                        {new Date(fireAlarmPreviousTrigger.unix_millis_time).toLocaleString()}
                      </Typography>
                    </div>
                  ) : fireAlarmPreviousTrigger && !fireAlarmPreviousTrigger.trigger ? (
                    <div>
                      <Typography variant="subtitle2" alignContent="center">
                        Last fire alarm reset on:
                      </Typography>
                      <Typography variant="body2" alignContent="center">
                        {new Date(fireAlarmPreviousTrigger.unix_millis_time).toLocaleString()}
                      </Typography>
                    </div>
                  ) : (
                    <div>
                      <Typography variant="subtitle2" alignContent="center">
                        Last fire alarm triggered on:
                      </Typography>
                      <Typography variant="body2" alignContent="center">
                        n/a
                      </Typography>
                    </div>
                  )}
                  <Button
                    variant="contained"
                    onClick={() => setOpenFireAlarmTriggerResetDialog(true)}
                    startIcon={<LocalFireDepartment />}
                  >
                    Reset fire alarm
                  </Button>
                </Stack>
              </Stack>
            </DialogActions>
          </Dialog>
        )}
        {openFireAlarmTriggerResetDialog && (
          <ConfirmationDialog
            confirmText="Confirm reset"
            cancelText="Cancel"
            open={true}
            title={'Reset fire alarm trigger'}
            submitting={undefined}
            onClose={() => setOpenFireAlarmTriggerResetDialog(false)}
            onSubmit={handleResetFireAlarmTrigger}
          >
            <Typography color="warning.main">
              Warning: Please ensure that all other systems are back online and that it is safe to
              resume robot operations.
            </Typography>
          </ConfirmationDialog>
        )}
      </MuiAppBar>
    );
  },
);

export default AppBar;
