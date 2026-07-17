import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import type { HealthSample, Robot } from '../../api/types';
import { BatteryIndicator } from '../../components/BatteryIndicator';
import { JsonView } from '../../components/JsonView';
import { StatusChip } from '../../components/StatusChip';
import { useFetch } from '../../hooks/useFetch';
import { HealthSparkline } from './HealthSparkline';

interface RobotDetailDrawerProps {
  robot: Robot;
  onClose: () => void;
}

const DRAWER_WIDTH = 400;

export function RobotDetailDrawer({ robot, onClose }: RobotDetailDrawerProps): ReactElement {
  const { data: history } = useFetch<HealthSample[]>(
    `/api/v1/robots/${robot.id}/health`,
  );

  const samples = history ?? [];

  return (
    <Drawer anchor="right" open onClose={onClose}>
      <Box sx={{ width: DRAWER_WIDTH, p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h4">{robot.name}</Typography>
          <IconButton onClick={onClose} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Box>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Serial {robot.serial} - MAC {robot.mac} - FW{' '}
              {robot.firmwareVersion ?? 'unknown'}
            </Typography>
          </Box>
          <BatteryIndicator
            percent={robot.batteryPercent}
            charging={robot.mode === 'charging'}
          />
          {robot.health?.estop === true && (
            <StatusChip label="E-STOP engaged" tone="error" />
          )}
          <Divider />
          <Typography variant="h6">Health history</Typography>
          <HealthSparkline
            label="Battery"
            unit="%"
            values={samples.map((s) => s.batteryPercent)}
          />
          <HealthSparkline
            label="WiFi RSSI"
            unit="dBm"
            values={samples.map((s) => s.wifiRssi)}
          />
          <HealthSparkline
            label="CPU temperature"
            unit="C"
            values={samples.map((s) => s.cpuTempC)}
          />
          <Divider />
          <Typography variant="h6">Raw state</Typography>
          <JsonView value={robot} maxHeight={240} />
        </Stack>
      </Box>
    </Drawer>
  );
}
