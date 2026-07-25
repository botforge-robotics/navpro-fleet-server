import 'react-grid-layout/css/styles.css';
import './no-rgl-animations.css';

import { Box, styled } from '@mui/material';
import React from 'react';
import { default as GridLayout_, Layout as WindowLayout, WidthProvider } from 'react-grid-layout';

import { WindowManagerStateContext } from './context';

export type { Layout as WindowLayout } from 'react-grid-layout';

const GridLayout = WidthProvider(GridLayout_);
// TODO: mui 5 switched theme spacing to string, instead of converting css units to px, just use
// a fixed margin for now.
/** Tight gap between map/table windows — modern dense operator layout. */
const MARGIN = 6;
const DEFAULT_ROW_HEIGHT = 150;
const MIN_ROW_HEIGHT = 48;

export type WindowContainerProps = React.PropsWithChildren<{
  /**
   * Layout works by splitting the available space into 12 columns and rows.
   * The values defined in the layouts are in column / row units. The size of each
   * column and row is automatically adjusted based on the size of the container.
   */
  layout: WindowLayout[];

  cols?: number;

  /**
   * Enables dragging and resizing of windows.
   */
  designMode?: boolean;
  onLayoutChange?: (newLayout: WindowLayout[]) => void;
}>;

function maxGridRows(layout: WindowLayout[]): number {
  return layout.reduce((max, item) => Math.max(max, item.y + item.h), 12);
}

/**
 * A resizable and draggable grid layout based on react-grid-layout. By default, the layout
 * follows material-ui convention of 12 columns and rows.
 */
export const WindowContainer: React.FC<WindowContainerProps> = ({
  layout,
  cols = 12,
  designMode = false,
  onLayoutChange,
  children,
}: WindowContainerProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = React.useState(DEFAULT_ROW_HEIGHT);

  const windowManagerState = React.useMemo(
    () => ({
      designMode: designMode ?? false,
    }),
    [designMode],
  );

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const updateRowHeight = () => {
      const rows = maxGridRows(layout);
      const available = el.clientHeight - MARGIN * (rows + 1);
      setRowHeight(Math.max(MIN_ROW_HEIGHT, Math.floor(available / rows)));
    };

    updateRowHeight();
    const observer = new ResizeObserver(updateRowHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);

  return (
    <WindowManagerStateContext.Provider value={windowManagerState}>
      <Box ref={containerRef} sx={{ height: '100%', width: '100%', minHeight: 0 }}>
        <GridLayout
          layout={layout}
          margin={[MARGIN, MARGIN]}
          cols={cols}
          rowHeight={rowHeight}
          compactType={null}
          preventCollision
          isResizable={designMode}
          isDraggable={designMode}
          onLayoutChange={onLayoutChange}
          draggableCancel=".custom-resize-handle,.window-toolbar-close"
          resizeHandle={<ResizeHandle className="custom-resize-handle" />}
        >
          {children}
        </GridLayout>
      </Box>
    </WindowManagerStateContext.Provider>
  );
};

/**
 * A custom resize handle that uses theme properties
 */
const ResizeHandle = styled('span')(({ theme }) => ({
  position: 'absolute',
  right: theme.spacing(1),
  bottom: theme.spacing(1),
  width: 20,
  height: 20,
  cursor: 'se-resize',
  '&::after': {
    content: '""',
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: '0.5rem',
    height: '0.5rem',
    borderRight: `2px solid ${theme.palette.grey[500]}`,
    borderBottom: `2px solid ${theme.palette.grey[500]}`,
  },
}));
