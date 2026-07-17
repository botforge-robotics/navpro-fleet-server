import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AssignmentIcon from '@mui/icons-material/Assignment';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LogoutIcon from '@mui/icons-material/Logout';
import MapIcon from '@mui/icons-material/Map';
import MemoryIcon from '@mui/icons-material/Memory';
import SettingsIcon from '@mui/icons-material/Settings';
import WifiIcon from '@mui/icons-material/Wifi';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearSession, getUser } from '../api/auth';
import { fleetWs } from '../api/ws';
import { StatusChip } from '../components/StatusChip';
import { useFleetLiveState } from '../hooks/useFleetLiveState';

const DRAWER_WIDTH = 240;

const navItems = [
  { to: '/overview', label: 'Overview', icon: <DashboardIcon /> },
  { to: '/missions', label: 'Missions', icon: <AssignmentIcon /> },
  { to: '/workflows', label: 'Workflows', icon: <AccountTreeIcon /> },
  { to: '/map', label: 'Map', icon: <MapIcon /> },
  { to: '/devices', label: 'Devices', icon: <MemoryIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
] as const;

/**
 * App shell: persistent header with fleet-wide e-stop/connection status
 * (operator-floor requirement: unmissable on every route) + nav drawer.
 */
export function AppLayout(): ReactElement {
  const navigate = useNavigate();
  const { robots, wsConnected } = useFleetLiveState();
  const [user] = useState(getUser());

  useEffect(() => () => fleetWs.close(), []);

  const estopCount = robots.filter((r) => r.health?.estop === true).length;
  const errorCount = robots.filter((r) => r.mode === 'error').length;

  const handleLogout = (): void => {
    fleetWs.close();
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography
            variant="h5"
            component="div"
            sx={{ flexGrow: 0, fontWeight: 700, letterSpacing: '-0.02em' }}
          >
            NavPro Fleet
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexGrow: 1, ml: 2 }}>
            {estopCount > 0 && (
              <StatusChip tone="error" label={`E-STOP: ${estopCount} robot(s)`} />
            )}
            {errorCount > 0 && (
              <StatusChip tone="warning" label={`Errors: ${errorCount}`} />
            )}
            {estopCount === 0 && errorCount === 0 && (
              <StatusChip tone="success" label="Fleet nominal" />
            )}
          </Box>
          <Tooltip title={wsConnected ? 'Live connection active' : 'Live connection down (REST fallback)'}>
            {wsConnected ? <WifiIcon color="success" /> : <WifiOffIcon color="error" />}
          </Tooltip>
          <Typography variant="body2" color="text.secondary">
            {user?.username ?? 'operator'}
          </Typography>
          <Tooltip title="Log out">
            <IconButton onClick={handleLogout} aria-label="log out">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <List>
          {navItems.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={false}
              sx={{
                '&.active': {
                  bgcolor: 'action.selected',
                  color: 'primary.light',
                },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
