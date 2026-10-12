import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { ReactElement, ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps): ReactElement {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 3,
        mb: 4,
        pb: 3,
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        position: 'relative',
        '&::after': {
          content: '""',
          position: 'absolute',
          left: 0,
          bottom: -1,
          width: 56,
          height: 2,
          borderRadius: 1,
          bgcolor: 'primary.main',
          boxShadow: (theme) => `0 0 12px ${alpha(theme.palette.primary.main, 0.4)}`,
        },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: 'block', mb: 0.75, opacity: 0.85 }}
        >
          NavPro Fleet
        </Typography>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          {title}
        </Typography>
        {subtitle !== undefined && (
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mt: 1.25, maxWidth: 640, lineHeight: 1.55 }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions !== undefined && (
        <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0, alignItems: 'center', pt: 3.5 }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}
