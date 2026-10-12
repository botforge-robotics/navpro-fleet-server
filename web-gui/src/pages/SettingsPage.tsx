import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { getUser } from '../api/auth';
import type { ServerInfo } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { useFetch } from '../hooks/useFetch';

export function SettingsPage(): ReactElement {
  const { data: info, error } = useFetch<ServerInfo>('/api/v1/server/info');
  const user = getUser();

  return (
    <Box>
      <PageHeader
        title="Settings"
        subtitle="Account context, platform health, and observability links."
      />
      {error !== null && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Account
              </Typography>
              <Typography variant="h5" sx={{ mb: 1.5, fontWeight: 600 }}>
                Users
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                Signed in as {user?.username ?? 'unknown'} ({user?.role ?? '-'}).
                User accounts and roles are managed by an administrator on the
                fleet server; self-service user management is on the roadmap.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Platform
              </Typography>
              <Typography variant="h5" sx={{ mb: 1.5, fontWeight: 600 }}>
                Server
              </Typography>
              {info === null ? (
                <Typography variant="body2" color="text.secondary">
                  Loading server info...
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Typography variant="body2">
                    Platform version {info.version}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Uptime {Math.floor(info.uptimeSeconds / 3600)}h{' '}
                    {Math.floor((info.uptimeSeconds % 3600) / 60)}m
                  </Typography>
                  <Box>
                    <StatusChip
                      label={info.rmfConnected ? 'RMF connected' : 'RMF disconnected'}
                      tone={info.rmfConnected ? 'success' : 'error'}
                    />
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Monitoring
              </Typography>
              <Typography variant="h5" sx={{ mb: 1.5, fontWeight: 600 }}>
                Observability
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
                Metrics, health dashboards and per-robot logs are served by
                Grafana on the fleet server.
              </Typography>
              <Button
                variant="outlined"
                endIcon={<OpenInNewIcon />}
                component="a"
                href="/grafana"
                target="_blank"
                rel="noopener"
              >
                Open Grafana
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
