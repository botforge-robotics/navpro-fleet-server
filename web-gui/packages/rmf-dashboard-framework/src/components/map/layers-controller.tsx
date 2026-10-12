import {
  Fullscreen as FullscreenIcon,
  Layers as LayersIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  MenuItem,
  TextField,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Level } from 'api-client';
import React from 'react';
import { ChangeEvent } from 'react';

import { AppEvents } from '../app-events';

interface LayersControllerProps {
  disabledLayers: Record<string, boolean>;
  onChange: (event: ChangeEvent<HTMLInputElement>, value: string) => void;
  levels: Level[];
  currentLevel: Level;
  handleFullView: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
}

export const LayersController = ({
  disabledLayers,
  onChange,
  levels,
  currentLevel,
  handleFullView,
  handleZoomIn,
  handleZoomOut,
}: LayersControllerProps) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 16,
        left: 12,
        width: 'auto',
        height: 'auto',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 1,
        borderRadius: 2,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.88),
        backdropFilter: 'blur(12px)',
        boxShadow: 1,
      }}
    >
      <FormControl>
        <TextField
          select
          id="level-select"
          label="Levels"
          variant="outlined"
          fullWidth
          margin="none"
          value={currentLevel.name}
          size="small"
          sx={{
            width: 64,
            minWidth: 64,
            '& .MuiInputLabel-root': { fontSize: '0.75rem' },
            '& .MuiSelect-select': { py: 0.75, fontSize: '0.8125rem' },
          }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e, e.target.value as string)}
        >
          {levels.map((level, i) => (
            <MenuItem key={i} value={level.name}>
              {level.name}
            </MenuItem>
          ))}
        </TextField>
      </FormControl>
      <IconButton
        size="small"
        onClick={handleFullView}
        data-testid="full-view"
        sx={{ alignSelf: 'flex-start' }}
      >
        <FullscreenIcon />
      </IconButton>
      <IconButton
        size="small"
        onClick={handleZoomIn}
        data-testid="zoom-in"
        sx={{ alignSelf: 'flex-start' }}
      >
        <ZoomInIcon />
      </IconButton>
      <IconButton
        size="small"
        onClick={handleZoomOut}
        data-testid="zoom-out"
        sx={{ alignSelf: 'flex-start' }}
      >
        <ZoomOutIcon />
      </IconButton>
      <Box onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <IconButton size="small" data-testid="layers" sx={{ alignSelf: 'flex-start' }}>
          <LayersIcon />
        </IconButton>
        {isHovered && (
          <Box
            sx={{
              mt: 0.5,
              p: 1.5,
              borderRadius: 2,
              border: (theme) => `1px solid ${theme.palette.divider}`,
              bgcolor: (theme) => alpha(theme.palette.background.paper, 0.96),
              boxShadow: 2,
              minWidth: 200,
            }}
          >
            {Object.keys(disabledLayers).map((layerName) => (
              <FormGroup key={layerName}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={!disabledLayers[layerName]}
                      onChange={() => {
                        const updatedLayers = { ...disabledLayers };
                        updatedLayers[layerName] = !updatedLayers[layerName];
                        AppEvents.disabledLayers.next(updatedLayers);
                      }}
                    />
                  }
                  label={layerName}
                  sx={{
                    margin: 0,
                    '& .MuiFormControlLabel-label': { typography: 'body2' },
                  }}
                />
              </FormGroup>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};
