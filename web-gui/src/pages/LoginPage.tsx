import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { setSession } from '../api/auth';
import { api } from '../api/client';
import type { LoginResponse } from '../api/types';
import { BrandMark } from '../components/BrandMark';
import { canvasBackground, operatorTokens, radii } from '../theme/appTheme';

const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string(),
    username: z.string(),
    role: z.enum(['operator', 'supervisor', 'admin', 'support']),
  }),
});

export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const raw = await api.post<LoginResponse>('/api/v1/auth/login', {
        username,
        password,
      });
      const session = loginResponseSchema.parse(raw);
      setSession(session);
      navigate(from, { replace: true });
    } catch {
      setError('Login failed. Check username and password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' },
        bgcolor: 'background.default',
      }}
    >
      {/* Brand panel */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 8,
          position: 'relative',
          overflow: 'hidden',
          backgroundImage: canvasBackground,
          borderRight: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: 0.35,
            backgroundImage: (theme) =>
              `linear-gradient(${alpha(theme.palette.divider, 0.45)} 1px, transparent 1px),
               linear-gradient(90deg, ${alpha(theme.palette.divider, 0.45)} 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at 28% 42%, black 8%, transparent 72%)',
          }}
        />
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ position: 'relative' }}>
          <BrandMark size={40} />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              NavPro
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Fleet operations
            </Typography>
          </Box>
        </Stack>

        <Box sx={{ position: 'relative', maxWidth: 440 }}>
          <Typography
            variant="overline"
            color="primary.light"
            sx={{ display: 'block', mb: 2 }}
          >
            Operator console
          </Typography>
          <Typography variant="h2" sx={{ mb: 2.5, fontWeight: 700, letterSpacing: '-0.03em' }}>
            Command the fleet with clarity.
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 380, lineHeight: 1.65 }}>
            Live robots, maps, missions, and building hardware — one secure console for the floor.
          </Typography>
        </Box>

        <Typography variant="caption" color="text.disabled" sx={{ position: 'relative' }}>
          NavPro Fleet · secured session
        </Typography>
      </Box>

      {/* Form panel */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 3, sm: 6 },
          backgroundImage: {
            xs: canvasBackground,
            md: 'none',
          },
          bgcolor: { md: 'background.paper' },
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 400,
            p: { xs: 0, md: 1 },
          }}
        >
          <Stack spacing={1.25} sx={{ mb: 4, display: { md: 'none' } }} alignItems="flex-start">
            <BrandMark size={36} />
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              NavPro Fleet
            </Typography>
          </Stack>

          <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Sign in
          </Typography>
          <Typography variant="h3" sx={{ mb: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Welcome back
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4, lineHeight: 1.55 }}>
            Use your fleet operator credentials to continue.
          </Typography>

          {error !== null && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={(theme) => ({
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
              '& .MuiOutlinedInput-root': {
                overflow: 'hidden',
                minHeight: operatorTokens.touchTargetMinPx + 8,
              },
              '& .MuiOutlinedInput-input': {
                py: 1.75,
              },
              '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
                {
                  WebkitTextFillColor: theme.palette.text.primary,
                  caretColor: theme.palette.text.primary,
                  borderRadius: 'inherit',
                  transition: 'background-color 99999s ease-out 0s',
                  WebkitBoxShadow: `0 0 0 1000px ${theme.palette.background.paper} inset`,
                  boxShadow: `0 0 0 1000px ${theme.palette.background.paper} inset`,
                },
            })}
          >
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              fullWidth
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start" sx={{ mr: 0.5 }}>
                    <PersonOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              fullWidth
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start" sx={{ mr: 0.5 }}>
                    <LockOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={busy}
              size="large"
              fullWidth
              sx={{
                mt: 1,
                minHeight: operatorTokens.touchTargetMinPx,
                borderRadius: `${radii.button}px`,
              }}
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
