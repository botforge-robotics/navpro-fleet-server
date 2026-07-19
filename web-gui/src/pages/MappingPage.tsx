import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import StopIcon from '@mui/icons-material/Stop';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Fab from '@mui/material/Fab';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { PointerEvent as ReactPointerEvent, ReactElement, TouchEvent as ReactTouchEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Level, Robot } from '../api/types';
import { useFetch } from '../hooks/useFetch';

type MappingState = 'idle' | 'starting' | 'active' | 'saving' | 'saved' | 'error' | string;

interface PreviewMeta {
  width: number | null;
  height: number | null;
  resolution: number | null;
  originX: number | null;
  originY: number | null;
  /** When true (default from bridge), PNG row 0 is map top. */
  yFlipped?: boolean;
  pose?: { x: number; y: number; yaw: number } | null;
}

interface ScanOverlay {
  xy?: number[];
  ts?: number;
}

interface MappingStatus {
  state: MappingState;
  error?: string | null;
  previewUpdatedAt?: string | null;
  preview?: PreviewMeta | null;
  scan?: ScanOverlay | null;
}

const DEADZONE = 0.08;

function Joystick({
  disabled,
  onMove,
}: {
  disabled: boolean;
  onMove: (linear: number, angular: number) => void;
}): ReactElement {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const emitFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = areaRef.current;
      if (!el || disabled) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = Math.min(rect.width, rect.height) / 2 - 8;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR && dist > 0) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      setKnob({ x: dx, y: dy });
      let linear = Math.max(-1, Math.min(1, -dy / maxR));
      let angular = Math.max(-1, Math.min(1, -dx / maxR));
      if (Math.abs(linear) < DEADZONE && Math.abs(angular) < DEADZONE) {
        linear = 0;
        angular = 0;
      }
      onMoveRef.current(linear, angular);
    },
    [disabled],
  );

  const stop = useCallback(() => {
    active.current = false;
    setKnob({ x: 0, y: 0 });
    onMoveRef.current(0, 0);
  }, []);

  useEffect(() => {
    const onUp = (): void => {
      if (active.current) stop();
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [stop]);

  return (
    <Box
      ref={areaRef}
      sx={{
        width: 148,
        height: 148,
        borderRadius: '50%',
        border: '2px solid',
        borderColor: disabled ? 'rgba(255,255,255,0.25)' : 'primary.main',
        bgcolor: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        position: 'relative',
        touchAction: 'none',
        opacity: disabled ? 0.4 : 1,
        userSelect: 'none',
        boxShadow: 4,
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        active.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        emitFromPointer(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!active.current) return;
        emitFromPointer(e.clientX, e.clientY);
      }}
      onPointerUp={() => stop()}
      onLostPointerCapture={() => stop()}
    >
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 48,
          height: 48,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          boxShadow: 3,
        }}
      />
    </Box>
  );
}

function mapToPixel(
  pose: { x: number; y: number },
  meta: PreviewMeta,
  displayW: number,
  displayH: number,
): { px: number; py: number } | null {
  if (
    meta.width == null ||
    meta.height == null ||
    meta.resolution == null ||
    meta.originX == null ||
    meta.originY == null ||
    meta.width < 1 ||
    meta.height < 1 ||
    meta.resolution <= 0
  ) {
    return null;
  }
  // PNG is flipped to image coords (row 0 = top); ROS OccupancyGrid row 0 = bottom.
  const imgX = (pose.x - meta.originX) / meta.resolution;
  const rawY = (pose.y - meta.originY) / meta.resolution;
  const imgY = meta.yFlipped === false ? rawY : meta.height - rawY;
  const sx = displayW / meta.width;
  const sy = displayH / meta.height;
  return { px: imgX * sx, py: imgY * sy };
}

/** Inverse of mapToPixel — image pixels → map-frame meters. */
function pixelToMap(
  px: number,
  py: number,
  meta: PreviewMeta,
  displayW: number,
  displayH: number,
): { x: number; y: number } | null {
  if (
    meta.width == null ||
    meta.height == null ||
    meta.resolution == null ||
    meta.originX == null ||
    meta.originY == null ||
    meta.width < 1 ||
    meta.height < 1 ||
    meta.resolution <= 0 ||
    displayW < 1 ||
    displayH < 1
  ) {
    return null;
  }
  const imgX = (px * meta.width) / displayW;
  const imgY = (py * meta.height) / displayH;
  const rawY = meta.yFlipped === false ? imgY : meta.height - imgY;
  return {
    x: meta.originX + imgX * meta.resolution,
    y: meta.originY + rawY * meta.resolution,
  };
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 24;

/**
 * Occupancy-map viewer with fixed map frame: when the SLAM grid grows /
 * origin shifts, the view is re-anchored so the world stays put and the
 * robot marker moves (RViz Fixed Frame = map).
 */
function InteractiveMap({
  previewUrl,
  pose,
  previewMeta,
  scanXy,
}: {
  previewUrl: string;
  pose: { x: number; y: number; yaw: number } | null;
  previewMeta: PreviewMeta | null;
  scanXy: number[] | null;
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const [mapBox, setMapBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const fittedRef = useRef(false);
  const metaRef = useRef<PreviewMeta | null>(null);
  const boxRef = useRef({ w: 0, h: 0 });

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{
    dist: number;
    scale: number;
  } | null>(null);

  /** Fit map into viewport (contain) and center — transform origin top-left. */
  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    const img = mapImgRef.current;
    if (!vp || !img || !img.naturalWidth) return;
    const pad = 32;
    const vw = Math.max(1, vp.clientWidth - pad * 2);
    const vh = Math.max(1, vp.clientHeight - pad * 2);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fit = Math.min(vw / nw, vh / nh);
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
    setMapBox({ w: nw, h: nh });
    boxRef.current = { w: nw, h: nh };
    setView({
      scale,
      x: (vp.clientWidth - nw * scale) / 2,
      y: (vp.clientHeight - nh * scale) / 2,
    });
    fittedRef.current = true;
  }, []);

  /**
   * Keep the same map-frame point under the viewport center when the
   * occupancy grid origin/size/resolution changes (prevents map jump).
   */
  useEffect(() => {
    if (!previewMeta || mapBox.w < 1 || mapBox.h < 1) return;

    const prevMeta = metaRef.current;
    const prevBox = boxRef.current;
    metaRef.current = previewMeta;
    boxRef.current = mapBox;

    if (!fittedRef.current || !prevMeta || prevBox.w < 1) return;

    const same =
      prevMeta.originX === previewMeta.originX &&
      prevMeta.originY === previewMeta.originY &&
      prevMeta.width === previewMeta.width &&
      prevMeta.height === previewMeta.height &&
      prevMeta.resolution === previewMeta.resolution &&
      prevBox.w === mapBox.w &&
      prevBox.h === mapBox.h;
    if (same) return;

    const vp = viewportRef.current;
    if (!vp) return;
    const v = viewRef.current;
    const oldRes = prevMeta.resolution ?? 0.05;
    const newRes = previewMeta.resolution ?? oldRes;
    // Preserve meters-on-screen zoom when preview downsampling changes.
    let scale = v.scale * (newRes / Math.max(1e-6, oldRes));
    scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

    const imgCx = (vp.clientWidth / 2 - v.x) / v.scale;
    const imgCy = (vp.clientHeight / 2 - v.y) / v.scale;
    const world = pixelToMap(imgCx, imgCy, prevMeta, prevBox.w, prevBox.h);
    if (!world) return;
    const next = mapToPixel(world, previewMeta, mapBox.w, mapBox.h);
    if (!next) return;
    setView({
      scale,
      x: vp.clientWidth / 2 - next.px * scale,
      y: vp.clientHeight / 2 - next.py * scale,
    });
  }, [previewMeta, mapBox]);

  /** Zoom so the world point under (clientX, clientY) stays fixed. */
  const zoomAt = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const prev = viewRef.current;
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));
    if (Math.abs(scale - prev.scale) < 1e-6) return;
    const ratio = scale / prev.scale;
    setView({
      scale,
      x: cx - (cx - prev.x) * ratio,
      y: cy - (cy - prev.y) * ratio,
    });
  }, []);

  const resetView = useCallback(() => {
    fitToView();
  }, [fitToView]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX, e.clientY, viewRef.current.scale * factor);
    };
    const onMove = (e: PointerEvent): void => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('pointermove', onMove);
    return () => {
      vp.removeEventListener('wheel', onWheel);
      vp.removeEventListener('pointermove', onMove);
    };
  }, [zoomAt]);

  const zoomFromButton = (factor: number): void => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    const p = pointerRef.current;
    const cx = p && p.x >= vp.left && p.x <= vp.right ? p.x : vp.left + vp.width / 2;
    const cy = p && p.y >= vp.top && p.y <= vp.bottom ? p.y : vp.top + vp.height / 2;
    zoomAt(cx, cy, viewRef.current.scale * factor);
  };

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent): void => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setView({
      scale: viewRef.current.scale,
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY),
    });
  };

  const onPointerUp = (e: ReactPointerEvent): void => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  };

  const onTouchStart = (e: ReactTouchEvent): void => {
    if (e.touches.length === 2) {
      dragRef.current = null;
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchRef.current = {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        scale: viewRef.current.scale,
      };
    }
  };

  const onTouchMove = (e: ReactTouchEvent): void => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const next = pinchRef.current.scale * (dist / Math.max(1, pinchRef.current.dist));
      zoomAt(midX, midY, next);
    }
  };

  const onTouchEnd = (): void => {
    if (pinchRef.current) pinchRef.current = null;
  };

  const marker =
    pose && previewMeta && mapBox.w > 0
      ? mapToPixel(pose, previewMeta, mapBox.w, mapBox.h)
      : null;

  const scanDots = useMemo(() => {
    if (!scanXy || !previewMeta || mapBox.w < 1 || scanXy.length < 2) return [];
    const dots: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < scanXy.length; i += 2) {
      const p = mapToPixel(
        { x: scanXy[i], y: scanXy[i + 1] },
        previewMeta,
        mapBox.w,
        mapBox.h,
      );
      if (p) dots.push({ x: p.px, y: p.py });
    }
    return dots;
  }, [scanXy, previewMeta, mapBox.w, mapBox.h]);

  return (
    <Box
      ref={viewportRef}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        bgcolor: '#2a2a2a',
        backgroundImage:
          'linear-gradient(45deg, #252525 25%, transparent 25%), linear-gradient(-45deg, #252525 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #252525 75%), linear-gradient(-45deg, transparent 75%, #252525 75%)',
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        '&:active': { cursor: 'grabbing' },
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={resetView}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        <Box sx={{ position: 'relative', lineHeight: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.55)' }}>
          <Box
            component="img"
            ref={mapImgRef}
            src={previewUrl}
            alt="Live SLAM map"
            draggable={false}
            onLoad={() => {
              const el = mapImgRef.current;
              if (!el) return;
              const nw = el.naturalWidth;
              const nh = el.naturalHeight;
              if (!fittedRef.current) {
                fitToView();
                if (previewMeta) metaRef.current = previewMeta;
              } else {
                setMapBox({ w: nw, h: nh });
              }
            }}
            sx={{
              display: 'block',
              width: mapBox.w || 'auto',
              height: mapBox.h || 'auto',
              // Crisp occupancy cells like RViz / pmap (no bilinear blur)
              imageRendering: 'pixelated',
              pointerEvents: 'none',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          />
          {scanDots.length > 0 && (
            <Box
              component="svg"
              width={mapBox.w}
              height={mapBox.h}
              sx={{
                position: 'absolute',
                left: 0,
                top: 0,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              {scanDots.map((d, i) => (
                <circle
                  key={i}
                  cx={d.x}
                  cy={d.y}
                  r={Math.max(1.2, 2.2 / view.scale)}
                  fill="#ff3b3b"
                  fillOpacity={0.9}
                />
              ))}
            </Box>
          )}
          {marker && pose && (
            <Box
              sx={{
                position: 'absolute',
                left: marker.px,
                top: marker.py,
                width: 0,
                height: 0,
                // Keep marker size roughly constant on screen while zooming
                transform: `translate(-50%, -50%) rotate(${(-pose.yaw * 180) / Math.PI}deg) scale(${1 / view.scale})`,
                pointerEvents: 'none',
              }}
            >
              <Box
                sx={{
                  width: 0,
                  height: 0,
                  borderLeft: '10px solid transparent',
                  borderRight: '10px solid transparent',
                  borderBottom: '22px solid #00e5a8',
                  filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.85))',
                }}
              />
            </Box>
          )}
        </Box>
      </Box>

      <Stack
        direction="row"
        spacing={0.75}
        sx={{ position: 'absolute', bottom: 16, left: 16, zIndex: 2 }}
      >
        <Tooltip title="Zoom in (at pointer)">
          <Fab
            size="small"
            onClick={() => zoomFromButton(1.25)}
            sx={{ bgcolor: 'rgba(0,0,0,0.65)', color: 'common.white' }}
          >
            <Typography component="span" sx={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>
              +
            </Typography>
          </Fab>
        </Tooltip>
        <Tooltip title="Zoom out (at pointer)">
          <Fab
            size="small"
            onClick={() => zoomFromButton(1 / 1.25)}
            sx={{ bgcolor: 'rgba(0,0,0,0.65)', color: 'common.white' }}
          >
            <Typography component="span" sx={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>
              −
            </Typography>
          </Fab>
        </Tooltip>
        <Tooltip title="Fit map (or double-click)">
          <Fab
            size="small"
            onClick={resetView}
            sx={{ bgcolor: 'rgba(0,0,0,0.65)', color: 'common.white', fontSize: 11, px: 1.5 }}
            variant="extended"
          >
            Fit
          </Fab>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{
            alignSelf: 'center',
            color: 'grey.400',
            bgcolor: 'rgba(0,0,0,0.45)',
            px: 1,
            py: 0.5,
            borderRadius: 1,
          }}
        >
          {Math.round(view.scale * 100)}% · fixed map · robot moves
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * Full-screen SLAM map with floating controls + bottom-right joystick.
 */
export function MappingPage(): ReactElement {
  const { data: robots } = useFetch<Robot[]>('/api/v1/robots');
  const { data: levels } = useFetch<Level[]>('/api/v1/levels');
  /** Commissioned + online only — offline / pending robots cannot start SLAM. */
  const liveRobots = useMemo(
    () =>
      (robots ?? []).filter(
        (r) =>
          !r.retired &&
          r.status === 'active' &&
          Boolean(r.fleetId) &&
          Boolean(r.levelId) &&
          r.mode !== 'offline',
      ),
    [robots],
  );
  const [robotId, setRobotId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MappingStatus>({ state: 'idle' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta | null>(null);
  const [scanXy, setScanXy] = useState<number[] | null>(null);
  const [showSaveFloorForm, setShowSaveFloorForm] = useState(false);
  const previewBlobRef = useRef<string | null>(null);
  const teleopRef = useRef({ linear: 0, angular: 0 });
  const lastPreviewTs = useRef<string | null>(null);

  useEffect(() => {
    if (liveRobots.length === 0) {
      if (robotId) setRobotId('');
      return;
    }
    if (!robotId || !liveRobots.some((r) => r.id === robotId)) {
      setRobotId(liveRobots[0].id);
    }
  }, [liveRobots, robotId]);

  useEffect(() => {
    if (levelId || !levels?.length) return;
    setLevelId((levels.find((l) => l.name === 'L1') ?? levels[0]).id);
  }, [levels, levelId]);

  const selected = liveRobots.find((r) => r.id === robotId);
  const mappingLive =
    status.state === 'starting' || status.state === 'active' || status.state === 'saving';

  useEffect(() => {
    if (!robotId) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const st = await api.get<MappingStatus>(`/api/v1/robots/${robotId}/mapping/status`);
        if (cancelled) return;
        setStatus(st);
        if (st.state === 'idle' || st.state === 'saved') {
          if (previewBlobRef.current) {
            URL.revokeObjectURL(previewBlobRef.current);
            previewBlobRef.current = null;
          }
          lastPreviewTs.current = null;
          setPreviewUrl(null);
          setPreviewMeta(null);
          setScanXy(null);
        } else {
          if (st.preview) setPreviewMeta(st.preview);
          if (st.scan?.xy && Array.isArray(st.scan.xy)) {
            setScanXy(st.scan.xy);
          }
        }
        if (st.state === 'error' && st.error) setError(st.error);
        if (st.state === 'saved') {
          setMsg('Map saved to the selected floor on the fleet server.');
          setShowSaveFloorForm(false);
        }
        const ts = st.previewUpdatedAt ?? null;
        if (
          (st.state === 'active' || st.state === 'starting' || st.state === 'saving') &&
          ts &&
          ts !== lastPreviewTs.current
        ) {
          lastPreviewTs.current = ts;
          try {
            const blob = await api.getBlob(`/api/v1/robots/${robotId}/mapping/preview`);
            if (cancelled) return;
            if (previewBlobRef.current) URL.revokeObjectURL(previewBlobRef.current);
            const url = URL.createObjectURL(blob);
            previewBlobRef.current = url;
            setPreviewUrl(url);
          } catch {
            /* not ready */
          }
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [robotId]);

  useEffect(() => {
    return () => {
      if (previewBlobRef.current) URL.revokeObjectURL(previewBlobRef.current);
    };
  }, []);

  const postTeleop = useCallback(
    (linear: number, angular: number) => {
      if (!robotId) return;
      void api.post(`/api/v1/robots/${robotId}/teleop`, { linear, angular }).catch(() => undefined);
    },
    [robotId],
  );

  // Continuous stick stream + always send zeros on release.
  useEffect(() => {
    if (!robotId || !mappingLive) return;
    const id = window.setInterval(() => {
      const { linear, angular } = teleopRef.current;
      postTeleop(linear, angular);
    }, 80);
    return () => {
      window.clearInterval(id);
      postTeleop(0, 0);
    };
  }, [robotId, mappingLive, postTeleop]);

  const onJoystick = useCallback(
    (linear: number, angular: number) => {
      teleopRef.current = { linear, angular };
      // Immediate stop on release / center — do not wait for the interval.
      if (linear === 0 && angular === 0) {
        postTeleop(0, 0);
      }
    },
    [postTeleop],
  );

  const sendMapping = async (action: 'start' | 'stop' | 'save'): Promise<void> => {
    if (!robotId) {
      setError('Select a robot first.');
      return;
    }
    if (action === 'save' && !levelId) {
      setError('Select a floor before saving.');
      setShowSaveFloorForm(true);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.post(`/api/v1/robots/${robotId}/mapping`, {
        action,
        ...(action === 'save' ? { levelId } : {}),
      });
      const name = selected?.name ?? 'robot';
      if (action === 'start') {
        if (previewBlobRef.current) {
          URL.revokeObjectURL(previewBlobRef.current);
          previewBlobRef.current = null;
        }
        lastPreviewTs.current = null;
        setPreviewUrl(null);
        setPreviewMeta(null);
        setScanXy(null);
        setStatus({ state: 'starting' });
        setMsg(`Mapping starting on ${name}…`);
      } else if (action === 'stop') {
        postTeleop(0, 0);
        setShowSaveFloorForm(false);
        if (previewBlobRef.current) {
          URL.revokeObjectURL(previewBlobRef.current);
          previewBlobRef.current = null;
        }
        lastPreviewTs.current = null;
        setPreviewUrl(null);
        setPreviewMeta(null);
        setScanXy(null);
        setStatus({ state: 'idle' });
        setMsg(`Mapping stopped for ${name}.`);
      } else {
        setShowSaveFloorForm(false);
        setStatus({ state: 'saving' });
        setMsg(`Saving map from ${name} to floor…`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pose = previewMeta?.pose ?? null;
  const showStartPanel = !mappingLive && status.state !== 'saving';

  const stateLabel =
    status.state === 'starting'
      ? 'Starting SLAM…'
      : status.state === 'active'
        ? 'Mapping active'
        : status.state === 'saving'
          ? 'Saving…'
          : status.state === 'saved'
            ? 'Map saved'
            : status.state === 'error'
              ? 'Error'
              : 'Idle';

  return (
    <Box
      sx={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        height: '100%',
        bgcolor: '#0b0d10',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {/* Full-bleed interactive map */}
      <Box sx={{ position: 'absolute', inset: 0 }}>
        {status.state === 'starting' && !previewUrl ? (
          <Stack
            alignItems="center"
            spacing={1.5}
            sx={{ height: '100%', justifyContent: 'center' }}
          >
            <CircularProgress />
            <Typography variant="body2" color="grey.400">
              Starting SLAM on the robot…
            </Typography>
            <Typography variant="caption" color="grey.600">
              The live map appears here once the first occupancy grid arrives.
            </Typography>
          </Stack>
        ) : previewUrl ? (
          <InteractiveMap
            previewUrl={previewUrl}
            pose={pose}
            previewMeta={previewMeta}
            scanXy={scanXy}
          />
        ) : null}
      </Box>

      {/* Dim backdrop while start / save dialogs are open */}
      {(showStartPanel || showSaveFloorForm) && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            bgcolor: 'rgba(0,0,0,0.72)',
          }}
        />
      )}

      {/* Top status strip */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        {(status.state === 'starting' || status.state === 'saving') && (
          <CircularProgress size={18} sx={{ color: 'common.white' }} />
        )}
        <Typography
          variant="subtitle2"
          sx={{
            color: 'common.white',
            bgcolor: 'rgba(0,0,0,0.55)',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            pointerEvents: 'auto',
          }}
        >
          {stateLabel}
          {selected ? ` · ${selected.name}` : ''}
        </Typography>
      </Stack>

      {error !== null && (
        <Alert
          severity="error"
          sx={{ position: 'absolute', top: 48, left: 12, right: 12, zIndex: 3, maxWidth: 480 }}
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}
      {msg !== null && (
        <Alert
          severity="success"
          sx={{ position: 'absolute', top: 48, left: 12, right: 12, zIndex: 3, maxWidth: 480 }}
          onClose={() => setMsg(null)}
        >
          {msg}
        </Alert>
      )}

      {/* Floating action rail — left (during / after start only: save + stop) */}
      {mappingLive && (
        <Stack
          spacing={1.25}
          sx={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 3,
          }}
        >
          <Tooltip title="Save map to server" placement="right">
            <span>
              <Fab
                color="secondary"
                size="medium"
                disabled={busy || status.state !== 'active'}
                onClick={() => {
                  setShowSaveFloorForm(true);
                  setError(null);
                }}
              >
                <SaveIcon />
              </Fab>
            </span>
          </Tooltip>
          <Tooltip title="Stop mapping" placement="right">
            <span>
              <Fab
                size="medium"
                disabled={busy}
                onClick={() => void sendMapping('stop')}
                sx={{
                  bgcolor: 'grey.800',
                  color: 'common.white',
                  '&:hover': { bgcolor: 'grey.700' },
                }}
              >
                <StopIcon />
              </Fab>
            </span>
          </Tooltip>
        </Stack>
      )}

      {/* Start: select robot only */}
      {showStartPanel && !showSaveFloorForm && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 4,
            p: 2.5,
            width: 320,
            maxWidth: '90vw',
          }}
        >
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            Start mapping
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose the robot that will run SLAM, then start.
          </Typography>
          {liveRobots.length === 0 ? (
            <Alert severity="warning">
              No commissioned online robots — activate a robot under Devices and wait until it is
              online.
            </Alert>
          ) : (
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel id="mapping-robot-label">Robot</InputLabel>
                <Select
                  labelId="mapping-robot-label"
                  label="Robot"
                  value={robotId}
                  onChange={(e) => setRobotId(e.target.value)}
                >
                  {liveRobots.map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                startIcon={
                  busy ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />
                }
                disabled={busy || !robotId}
                onClick={() => void sendMapping('start')}
              >
                Start mapping
              </Button>
            </Stack>
          )}
        </Paper>
      )}

      {/* Save: select floor only */}
      {showSaveFloorForm && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 5,
            p: 2.5,
            width: 320,
            maxWidth: '90vw',
          }}
        >
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            Save map to floor
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Pick the floor this occupancy map belongs to, then upload to the fleet server.
          </Typography>
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel id="mapping-floor-label">Floor</InputLabel>
              <Select
                labelId="mapping-floor-label"
                label="Floor"
                value={levelId}
                onChange={(e) => setLevelId(e.target.value)}
              >
                {(levels ?? []).map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                fullWidth
                disabled={busy}
                onClick={() => setShowSaveFloorForm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                color="secondary"
                fullWidth
                startIcon={
                  busy ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />
                }
                disabled={busy || !levelId}
                onClick={() => void sendMapping('save')}
              >
                Save
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* Joystick — bottom right (only while mapping) */}
      {mappingLive && status.state !== 'saving' && (
        <Box sx={{ position: 'absolute', right: 16, bottom: 16, zIndex: 3 }}>
          <Joystick disabled={false} onMove={onJoystick} />
        </Box>
      )}
    </Box>
  );
}
