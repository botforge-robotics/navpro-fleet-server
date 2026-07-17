import { AppBar, AppBarProps, Box, Grid, Toolbar, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import React from 'react';

export interface WindowToolbarProps extends AppBarProps {
  title: string;
  toolbarItemContainerProps?: React.ComponentProps<typeof Box>;
}

export const WindowToolbar: React.FC<WindowToolbarProps> = ({
  title,
  toolbarItemContainerProps,
  children,
  sx,
  ...otherProps
}) => {
  return (
    <AppBar
      position="static"
      elevation={0}
      color="transparent"
      {...otherProps}
      sx={[
        {
          bgcolor: (theme) => alpha(theme.palette.background.default, 0.65),
          backdropFilter: 'blur(12px)',
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        },
        ...(Array.isArray(sx) ? sx : sx != null ? [sx] : []),
      ]}
    >
      <Toolbar variant="dense" disableGutters sx={{ px: 2, minHeight: 44 }}>
        <Grid container justifyContent="space-between" alignItems="center" wrap="nowrap">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box
              aria-hidden
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                boxShadow: (theme) => `0 0 8px ${alpha(theme.palette.primary.main, 0.45)}`,
                flexShrink: 0,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                color: 'text.primary',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </Typography>
          </Box>
          <Box display="flex" alignItems="center" {...toolbarItemContainerProps}>
            {children}
          </Box>
        </Grid>
      </Toolbar>
    </AppBar>
  );
};
