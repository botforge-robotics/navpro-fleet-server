import {
  InsertInvitation as ScheduleIcon,
  LowPriority,
  Person as UserIcon,
} from '@mui/icons-material';
import { Box, Stack, styled, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  DataGrid,
  getGridDateOperators,
  getGridStringOperators,
  GridCellParams,
  GridColumns,
  GridEventListener,
  GridFilterModel,
  GridRowParams,
  GridSortModel,
  GridValueGetterParams,
  MuiEvent,
} from '@mui/x-data-grid';
import {
  ApiServerModelsRmfApiTaskStateStatus as Status,
  TaskStateOutput as TaskState,
} from 'api-client';
import * as React from 'react';

import { TaskBookingLabels } from './booking-label';
import {
  formatRmfTime,
  formatRmfTimeOnly,
  taskRowId,
  toWallMillis,
} from './rmf-time';
import { getTaskBookingLabelFromTaskState } from './task-booking-label-utils';
import { parseTaskPriority } from './utils';

const classes = {
  taskActiveCell: 'MuiDataGrid-cell-active-cell',
  taskCancelledCell: 'MuiDataGrid-cell-cancelled-cell',
  taskCompletedCell: 'MuiDataGrid-cell-completed-cell',
  taskFailedCell: 'MuiDataGrid-cell-failed-cell',
  taskPendingCell: 'MuiDataGrid-cell-pending-cell',
  taskQueuedCell: 'MuiDataGrid-cell-queued-cell',
  taskUnknownCell: 'MuiDataGrid-cell-unknown-cell',
  taskLateCell: 'MuiDataGrid-cell-late-cell',
};

const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
  borderRadius: theme.shape.borderRadius,
  borderColor: theme.palette.divider,
  backgroundColor: theme.palette.background.paper,
  [`& .${classes.taskActiveCell}`]: {
    backgroundColor: alpha(theme.palette.success.main, 0.22),
    color: theme.palette.success.light,
    fontWeight: 600,
  },
  [`& .${classes.taskCancelledCell}`]: {
    backgroundColor: alpha(theme.palette.text.secondary, 0.14),
    color: theme.palette.text.secondary,
    fontWeight: 600,
  },
  [`& .${classes.taskCompletedCell}`]: {
    backgroundColor: alpha(theme.palette.info.main, 0.22),
    color: theme.palette.info.light,
    fontWeight: 600,
  },
  [`& .${classes.taskFailedCell}`]: {
    backgroundColor: alpha(theme.palette.error.main, 0.22),
    color: theme.palette.error.light,
    fontWeight: 600,
  },
  [`& .${classes.taskQueuedCell}`]: {
    backgroundColor: alpha(theme.palette.text.primary, 0.08),
    color: theme.palette.text.secondary,
    fontWeight: 600,
  },
  [`& .${classes.taskUnknownCell}`]: {
    backgroundColor: alpha(theme.palette.warning.main, 0.22),
    color: theme.palette.warning.light,
    fontWeight: 600,
  },
  [`& .${classes.taskLateCell}`]: {
    backgroundColor: alpha(theme.palette.warning.main, 0.28),
    color: theme.palette.warning.light,
    fontWeight: 600,
  },
})) as typeof DataGrid;

function isTaskOutdated(taskState: TaskState): boolean {
  if (
    !taskState.unix_millis_finish_time ||
    !taskState.status ||
    (taskState.status !== Status.Underway && taskState.status !== Status.Queued)
  ) {
    return false;
  }

  // Convert sim finish → wall before comparing to wall "now".
  const finishWall = toWallMillis(taskState.unix_millis_finish_time);
  if (finishWall == null) {
    return false;
  }
  return Date.now() > finishWall;
}

export interface Tasks {
  isLoading: boolean;
  data: TaskState[];
  total: number;
  page: number;
  pageSize: number;
}

interface TaskData {
  state: TaskState;
  requestLabel: TaskBookingLabels | null;
}

export interface FilterFields {
  model: GridFilterModel | undefined;
}

export interface SortFields {
  model: GridSortModel | undefined;
}

export type MuiMouseEvent = MuiEvent<React.MouseEvent<HTMLElement>>;

export interface TableDataGridState {
  tasks: Tasks;
  onTaskClick?(ev: MuiMouseEvent, task: TaskState): void;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newPageSize: number) => void;
  setFilterFields: React.Dispatch<React.SetStateAction<FilterFields>>;
  setSortFields: React.Dispatch<React.SetStateAction<SortFields>>;
}

const TaskRequester = (
  requester: string | undefined | null,
  scheduled: boolean,
  prioritized: boolean,
): JSX.Element => {
  if (!requester) {
    return <Typography variant="body1">n/a</Typography>;
  }

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      {prioritized ? (
        <Tooltip title="User prioritized">
          <LowPriority sx={{ transform: 'rotate(0.5turn)' }} />
        </Tooltip>
      ) : null}
      {scheduled ? (
        <Tooltip title="User scheduled">
          <ScheduleIcon />
        </Tooltip>
      ) : (
        <Tooltip title="User submitted">
          <UserIcon />
        </Tooltip>
      )}
      <Typography variant="body1">{requester}</Typography>
    </Stack>
  );
};

export function TaskDataGridTable({
  tasks,
  onTaskClick,
  onPageChange,
  onPageSizeChange,
  setFilterFields,
  setSortFields,
}: TableDataGridState): JSX.Element {
  const handleEvent: GridEventListener<'rowClick'> = (
    params: GridRowParams,
    event: MuiMouseEvent,
  ) => {
    if (onTaskClick) {
      onTaskClick(event, params.row.state);
    }
  };

  const getMinimalStringFilterOperators = getGridStringOperators().filter(
    // TODO: implement contains on the server end as well
    (operator) => operator.value === 'equals',
  );

  const getMinimalDateOperators = getGridDateOperators(true).filter(
    (operator) => operator.value === 'onOrAfter' || operator.value === 'onOrBefore',
  );

  const columns: GridColumns<TaskData> = [
    {
      field: 'unix_millis_request_time',
      headerName: 'Date',
      width: 150,
      editable: false,
      renderCell: (cellValues) => {
        if (!cellValues.row.state.booking.unix_millis_request_time) {
          return 'n/a';
        }
        return formatRmfTime(cellValues.row.state.booking.unix_millis_request_time);
      },
      flex: 1,
      filterOperators: getMinimalDateOperators,
      filterable: true,
    },
    {
      field: 'requester',
      headerName: 'Requester',
      width: 150,
      editable: false,
      renderCell: (cellValues) => {
        let prioritized = false;
        if (cellValues.row.state.booking.priority) {
          prioritized = parseTaskPriority(cellValues.row.state.booking.priority);
        }

        let scheduled = false;
        if (cellValues.row.requestLabel && 'scheduled' in cellValues.row.requestLabel) {
          scheduled = cellValues.row.requestLabel.scheduled === 'true';
        }

        return TaskRequester(cellValues.row.state.booking.requester, scheduled, prioritized);
      },
      flex: 1,
      filterOperators: getMinimalStringFilterOperators,
      filterable: true,
    },
    {
      field: 'label=pickup',
      headerName: 'Pickup',
      width: 150,
      editable: false,
      valueGetter: (params) => {
        if (params.row.requestLabel && params.row.requestLabel.pickup) {
          return params.row.requestLabel.pickup;
        }
        return 'n/a';
      },
      flex: 1,
      filterOperators: getMinimalStringFilterOperators,
      filterable: true,
    },
    {
      field: 'label=destination',
      headerName: 'Destination',
      width: 150,
      editable: false,
      valueGetter: (params) => {
        if (params.row.requestLabel && params.row.requestLabel.destination) {
          return params.row.requestLabel.destination;
        }
        return 'n/a';
      },
      flex: 1,
      filterOperators: getMinimalStringFilterOperators,
      filterable: true,
    },
    {
      field: 'assigned_to',
      headerName: 'Robot',
      width: 100,
      editable: false,
      valueGetter: (params) =>
        params.row.state.assigned_to ? params.row.state.assigned_to.name : 'n/a',
      flex: 1,
      filterOperators: getMinimalStringFilterOperators,
      filterable: true,
    },
    {
      field: 'unix_millis_start_time',
      headerName: 'Start Time',
      width: 150,
      editable: false,
      renderCell: (cellValues) => {
        const startMs = cellValues.row.state.unix_millis_start_time;
        return (
          <Tooltip
            title={
              <Typography variant="caption" noWrap>
                Start time: {formatRmfTime(startMs)}
              </Typography>
            }
          >
            <Box>{formatRmfTimeOnly(startMs)}</Box>
          </Tooltip>
        );
      },
      flex: 1,
      filterOperators: getMinimalDateOperators,
      filterable: true,
    },
    {
      field: 'unix_millis_finish_time',
      headerName: 'End Time',
      width: 150,
      editable: false,
      renderCell: (cellValues) => {
        let warnMs: number | undefined = undefined;
        if (cellValues.row.requestLabel && 'unix_millis_warn_time' in cellValues.row.requestLabel) {
          const warnMillisNum = parseInt(cellValues.row.requestLabel.unix_millis_warn_time);
          if (!Number.isNaN(warnMillisNum)) {
            warnMs = warnMillisNum;
          }
        }

        const finishMs = cellValues.row.state.unix_millis_finish_time;
        return (
          <Tooltip
            title={
              <React.Fragment>
                <Typography variant="caption" display="block" noWrap>
                  Warning time: {formatRmfTime(warnMs)}
                </Typography>
                <Typography variant="caption" noWrap>
                  Finish time: {formatRmfTime(finishMs)}
                </Typography>
              </React.Fragment>
            }
          >
            <Box>{formatRmfTimeOnly(finishMs)}</Box>
          </Tooltip>
        );
      },
      flex: 1,
      filterOperators: getMinimalDateOperators,
      filterable: true,
    },
    {
      field: 'status',
      headerName: 'State',
      editable: false,
      valueGetter: (params: GridValueGetterParams) =>
        params.row.state.status ? params.row.state.status : 'unknown',
      renderCell: (cellValues) => {
        const statusString = cellValues.row.state.status ? cellValues.row.state.status : 'unknown';
        if (isTaskOutdated(cellValues.row.state)) {
          return (
            <Tooltip
              title={
                <React.Fragment>
                  <Typography>
                    Finish time is in the past, but task is still queued or underway.
                  </Typography>
                  <Typography>
                    The task may have been interrupted or stalled during the execution.
                  </Typography>
                </React.Fragment>
              }
            >
              <Box>{`${statusString} (stale)`}</Box>
            </Tooltip>
          );
        }

        return <Box>{statusString}</Box>;
      },
      flex: 1,
      filterOperators: getMinimalStringFilterOperators,
      filterable: true,
    },
  ];

  const handleFilterModelChange = React.useCallback(
    (filterModel: GridFilterModel) => {
      setFilterFields({ model: filterModel });
    },
    [setFilterFields],
  );

  const handleSortModelChange = React.useCallback(
    (sortModel: GridSortModel) => {
      setSortFields({ model: sortModel });
    },
    [setSortFields],
  );

  const taskData: TaskData[] = tasks.data.map((state) => {
    return {
      state,
      requestLabel: getTaskBookingLabelFromTaskState(state),
    };
  });

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <StyledDataGrid
        getRowId={(r) => taskRowId(r.state)}
        rows={taskData}
        rowCount={tasks.total}
        loading={tasks.isLoading}
        pageSize={tasks.pageSize}
        rowsPerPageOptions={[10]}
        pagination
        paginationMode="server"
        filterMode="server"
        onFilterModelChange={handleFilterModelChange}
        sortingMode="server"
        onSortModelChange={handleSortModelChange}
        page={tasks.page - 1}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        columns={columns}
        onRowClick={handleEvent}
        getCellClassName={(params: GridCellParams<string>) => {
          if (params.field === 'status') {
            if (isTaskOutdated(params.row.state)) {
              return classes.taskUnknownCell;
            }

            switch (params.value) {
              case Status.Underway:
                return classes.taskActiveCell;
              case Status.Completed:
                return classes.taskCompletedCell;
              case Status.Canceled:
                return classes.taskCancelledCell;
              case Status.Failed:
                return classes.taskFailedCell;
              case Status.Queued:
                return classes.taskQueuedCell;
              default:
                return classes.taskUnknownCell;
            }
          } else if (params.field === 'unix_millis_finish_time') {
            if (!params.row.state.unix_millis_finish_time) {
              return classes.taskUnknownCell;
            }

            let warnMs: number | undefined = undefined;
            if (params.row.requestLabel && 'unix_millis_warn_time' in params.row.requestLabel) {
              const warnMillisNum = parseInt(params.row.requestLabel.unix_millis_warn_time);
              if (!Number.isNaN(warnMillisNum)) {
                warnMs = warnMillisNum;
              }
            }

            const finishMs = params.row.state.unix_millis_finish_time;
            const finishWall = toWallMillis(finishMs);
            const warnWall = warnMs != null ? toWallMillis(warnMs) : null;
            if (warnWall != null && finishWall != null && finishWall > warnWall) {
              return classes.taskLateCell;
            }
          }
          return '';
        }}
        disableVirtualization={true}
      />
    </div>
  );
}
