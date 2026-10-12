import Box from '@mui/material/Box';
import type { ReactElement } from 'react';
import { radii } from '../theme/appTheme';

interface JsonViewProps {
  value: unknown;
  maxHeight?: number;
}

/** Read-only pretty-printed JSON block, themed from tokens only. */
export function JsonView({ value, maxHeight = 320 }: JsonViewProps): ReactElement {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 2.5,
        maxHeight,
        overflow: 'auto',
        bgcolor: 'background.default',
        color: 'text.secondary',
        borderRadius: `${radii.control}px`,
        border: 1,
        borderColor: 'divider',
        typography: 'caption',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        lineHeight: 1.55,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}
