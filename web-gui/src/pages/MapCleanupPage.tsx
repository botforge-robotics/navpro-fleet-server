import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type {
  PointerEvent as ReactPointerEvent,
  ReactElement,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Level } from "../api/types";
import { useFetch } from "../hooks/useFetch";
import {
  brushCss,
  decodePgm,
  editScaleFromResolution,
  grayToUpscaledImage,
  OCCUPANCY_FREE,
  OCCUPANCY_OCCUPIED,
  OCCUPANCY_UNKNOWN,
  rgbToOccupancyGray,
  RVIZ_FREE_CSS,
  RVIZ_OCCUPIED_CSS,
  RVIZ_UNKNOWN_CSS,
  type OccupancyBrush,
} from "./mapEditUtils";

type Tool = 'paint' | 'line' | 'circle' | 'rect' | 'measure' | 'pan';

interface OccupancyMeta {
  metersPerPixel: number;
  originX: number;
  originY: number;
  yamlText: string;
  occupancyMapPath?: string;
  pgmBase64?: string;
}

function rotatedBounds(
  w: number,
  h: number,
  deg: number,
): { rw: number; rh: number } {
  const rad = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    rw: Math.max(1, Math.ceil(w * c + h * s)),
    rh: Math.max(1, Math.ceil(w * s + h * c)),
  };
}

/**
 * Map cleanup: upscale PGM for editing (~1 cm/px), save Nav2 PGM + floorplan PNG
 * at original size with map.yaml resolution (traffic-editor scale matches yaml).
 */
export function MapCleanupPage({
  embedded = false,
}: {
  embedded?: boolean;
}): ReactElement {
  const {
    data: levels,
    error: levelsErr,
    reload: reloadLevels,
  } = useFetch<Level[]>("/api/v1/levels");
  const [levelId, setLevelId] = useState("");
  const [tool, setTool] = useState<Tool>("paint");
  const [paintColor, setPaintColor] = useState<OccupancyBrush>("obstacle");
  const [brush, setBrush] = useState(8);
  const [rotation, setRotation] = useState(0);
  const [guideOpacity, setGuideOpacity] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapMeta, setMapMeta] = useState<OccupancyMeta | null>(null);
  const [navSize, setNavSize] = useState({ w: 0, h: 0 });
  const [editScale, setEditScale] = useState(5);
  const [mapSize, setMapSize] = useState({ w: 640, h: 480 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [canUndo, setCanUndo] = useState(false);
  const [measureLabel, setMeasureLabel] = useState<string | null>(null);

  // View transform (display only — does not resample map pixels).
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 40, y: 40 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const panning = useRef(false);
  const spaceDown = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const lineStart = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const viewZoomRef = useRef(viewZoom);
  const viewPanRef = useRef(viewPan);
  viewZoomRef.current = viewZoom;
  viewPanRef.current = viewPan;

  const selected = levels?.find((l) => l.id === levelId) ?? levels?.[0];

  useEffect(() => {
    if (!levelId && levels?.length) setLevelId(levels[0].id);
  }, [levels, levelId]);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setCanUndo(false);
  }, []);

  const clearPreview = useCallback(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, preview.width, preview.height);
  }, []);

  const pushHistory = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || draw.width < 1) return;
    const ctx = draw.getContext("2d");
    if (!ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, draw.width, draw.height));
    if (historyRef.current.length > 40) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const draw = drawRef.current;
    const snap = historyRef.current.pop();
    setCanUndo(historyRef.current.length > 0);
    if (!draw || !snap) return;
    if (snap.width !== draw.width || snap.height !== draw.height) return;
    const ctx = draw.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(snap, 0, 0);
    clearPreview();
    lineStart.current = null;
    drawing.current = false;
    lastPt.current = null;
  }, [clearPreview]);

  const paintGuide = useCallback(() => {
    const guide = guideRef.current;
    const img = sourceRef.current;
    if (!guide || !img || mapSize.w < 1) return;
    const ctx = guide.getContext("2d");
    if (!ctx) return;
    if (guide.width !== mapSize.w || guide.height !== mapSize.h) {
      guide.width = mapSize.w;
      guide.height = mapSize.h;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, mapSize.w, mapSize.h);
    if (guideOpacity <= 0) return;
    ctx.save();
    ctx.translate(mapSize.w / 2, mapSize.h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.globalAlpha = guideOpacity;
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }, [mapSize, rotation, guideOpacity]);

  const resetDrawLayer = useCallback(() => {
    const draw = drawRef.current;
    const preview = previewRef.current;
    const img = sourceRef.current;
    if (!draw || mapSize.w < 1) return;
    draw.width = mapSize.w;
    draw.height = mapSize.h;
    if (preview) {
      preview.width = mapSize.w;
      preview.height = mapSize.h;
    }
    const ctx = draw.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = RVIZ_UNKNOWN_CSS;
    ctx.fillRect(0, 0, mapSize.w, mapSize.h);
    if (img && img.naturalWidth > 0) {
      if (
        rotation === 0 &&
        img.naturalWidth === mapSize.w &&
        img.naturalHeight === mapSize.h
      ) {
        // 1:1 blit — no transform (avoids subpixel centering artifacts).
        ctx.drawImage(img, 0, 0);
      } else {
        ctx.save();
        ctx.translate(mapSize.w / 2, mapSize.h / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        ctx.restore();
      }
    }
    clearHistory();
    clearPreview();
    lineStart.current = null;
  }, [mapSize, rotation, clearHistory, clearPreview]);

  // Rebuild canvases when rotation changes bounds of upscaled edit image.
  useEffect(() => {
    if (navSize.w < 1) return;
    const srcW = navSize.w * editScale;
    const srcH = navSize.h * editScale;
    const { rw, rh } = rotatedBounds(srcW, srcH, rotation);
    setMapSize({ w: rw, h: rh });
  }, [navSize, editScale, rotation]);

  useEffect(() => {
    if (mapSize.w < 1) return;
    resetDrawLayer();
    paintGuide();
  }, [mapSize, paintGuide, resetDrawLayer]);

  // Re-paint guide when opacity changes without wiping strokes.
  useEffect(() => {
    paintGuide();
  }, [guideOpacity, paintGuide]);

  const fitView = useCallback((mw: number, mh: number) => {
    const vp = viewportRef.current;
    if (!vp || mw < 1 || mh < 1) return false;
    if (vp.clientWidth < 64 || vp.clientHeight < 64) return false;
    const pad = 24;
    const zx = (vp.clientWidth - pad * 2) / mw;
    const zy = (vp.clientHeight - pad * 2) / mh;
    const zoom = Math.min(8, Math.max(0.05, Math.min(zx, zy)));
    if (!Number.isFinite(zoom) || zoom <= 0) return false;
    setViewZoom(zoom);
    setViewPan({
      x: (vp.clientWidth - mw * zoom) / 2,
      y: (vp.clientHeight - mh * zoom) / 2,
    });
    return true;
  }, []);

  /** Keep retrying Fit until the flex layout gives a real viewport size. */
  const fitViewWhenReady = useCallback(
    (mw: number, mh: number) => {
      let tries = 0;
      const tick = () => {
        if (fitView(mw, mh)) return;
        tries += 1;
        if (tries < 30) window.setTimeout(tick, 50);
      };
      tick();
    },
    [fitView],
  );

  // Re-fit when the viewport actually gets a size (tab switch / layout settle).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || mapSize.w < 1) return;
    let lastW = 0;
    let lastH = 0;
    const tryFit = () => {
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (w < 64 || h < 64) return;
      if (lastW < 64 || Math.abs(w - lastW) > 24 || Math.abs(h - lastH) > 24) {
        fitView(mapSize.w, mapSize.h);
        lastW = w;
        lastH = h;
      }
    };
    tryFit();
    const ro = new ResizeObserver(() => tryFit());
    ro.observe(vp);
    return () => ro.disconnect();
  }, [mapSize.w, mapSize.h, fitView]);

  const loadLevel = useCallback(
    async (lvl: Level) => {
      setError(null);
      setMsg(null);
      setMapMeta(null);
      try {
        const occ = await api.get<
          OccupancyMeta & { pgmBase64: string; yamlText: string }
        >(`/api/v1/levels/${lvl.id}/occupancy`);
        let navRes = 0.05;
        try {
          const m = /^resolution:\s*([0-9.]+)/m.exec(occ.yamlText ?? "");
          if (m) navRes = Number(m[1]);
        } catch {
          /* ignore */
        }
        if (!(navRes > 0))
          navRes = occ.metersPerPixel > 0 ? occ.metersPerPixel : 0.05;
        if (navRes < 0.02) navRes = 0.05;
        const scale = editScaleFromResolution(navRes);

        const raw = atob(occ.pgmBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const { width: nw, height: nh, pixels } = decodePgm(bytes.buffer);
        if (nw * nh !== pixels.length) {
          throw new Error(
            `PGM size mismatch ${nw}×${nh} vs ${pixels.length} pixels`,
          );
        }

        const up = grayToUpscaledImage(pixels, nw, nh, scale);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to build edit image"));
          img.src = up.toDataURL("image/png");
        });
        if (
          img.naturalWidth !== nw * scale ||
          img.naturalHeight !== nh * scale
        ) {
          throw new Error(
            `edit image size ${img.naturalWidth}×${img.naturalHeight} != ${nw * scale}×${nh * scale}`,
          );
        }
        sourceRef.current = img;

        // Apply size state only after the bitmap is ready (avoids race drawing wrong size).
        setMapMeta({
          metersPerPixel: navRes,
          originX: occ.originX,
          originY: occ.originY,
          yamlText: occ.yamlText,
          occupancyMapPath: occ.occupancyMapPath,
          pgmBase64: occ.pgmBase64,
        });
        setEditScale(scale);
        setNavSize({ w: nw, h: nh });
        setRotation(0);
        const { rw, rh } = rotatedBounds(nw * scale, nh * scale, 0);
        setMapSize({ w: rw, h: rh });
        setViewZoom(1);
        setViewPan({ x: 0, y: 0 });

        requestAnimationFrame(() => {
          resetDrawLayer();
          paintGuide();
          fitViewWhenReady(rw, rh);
        });
        setMsg(`Loaded ${lvl.name} map (${nw}×${nh}).`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [fitViewWhenReady, paintGuide, resetDrawLayer],
  );

  useEffect(() => {
    if (selected) void loadLevel(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        spaceDown.current = true;
        e.preventDefault();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        undo();
      }
      if (e.key === "Escape") {
        clearPreview();
        lineStart.current = null;
        drawing.current = false;
        lastPt.current = null;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, clearPreview]);

  /** Client → map pixel (full resolution). */
  const mapPoint = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } => {
    const vp = viewportRef.current;
    if (!vp) return { x: 0, y: 0 };
    const rect = vp.getBoundingClientRect();
    const z = viewZoomRef.current;
    const p = viewPanRef.current;
    return {
      x: (clientX - rect.left - p.x) / z,
      y: (clientY - rect.top - p.y) / z,
    };
  };

  const stroke = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const ctx = drawRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brush;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = brushCss(paintColor);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const dab = (pt: { x: number; y: number }) => {
    const ctx = drawRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = brushCss(paintColor);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const ensurePreviewCtx = (): CanvasRenderingContext2D | null => {
    const preview = previewRef.current;
    if (!preview) return null;
    if (preview.width !== mapSize.w || preview.height !== mapSize.h) {
      preview.width = mapSize.w;
      preview.height = mapSize.h;
    }
    const ctx = preview.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.imageSmoothingEnabled = false;
    return ctx;
  };

  const fillCircle = (
    ctx: CanvasRenderingContext2D,
    center: { x: number; y: number },
    edge: { x: number; y: number },
  ): boolean => {
    const r = Math.hypot(edge.x - center.x, edge.y - center.y);
    if (r < 1) return false;
    ctx.fillStyle = brushCss(paintColor);
    ctx.beginPath();
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    ctx.fill();
    return true;
  };

  const fillRectCorners = (
    ctx: CanvasRenderingContext2D,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): boolean => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (w < 1 && h < 1) return false;
    ctx.fillStyle = brushCss(paintColor);
    ctx.fillRect(x, y, Math.max(1, w), Math.max(1, h));
    return true;
  };

  const drawLinePreview = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const ctx = ensurePreviewCtx();
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brush;
    ctx.strokeStyle = brushCss(paintColor);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = brushCss(paintColor);
    const r = Math.max(2, brush / 2);
    ctx.beginPath();
    ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawCirclePreview = (
    center: { x: number; y: number },
    edge: { x: number; y: number },
  ) => {
    const ctx = ensurePreviewCtx();
    if (!ctx) return;
    ctx.globalAlpha = 0.55;
    fillCircle(ctx, center, edge);
    ctx.globalAlpha = 1;
    // Center crosshair
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center.x - 4, center.y);
    ctx.lineTo(center.x + 4, center.y);
    ctx.moveTo(center.x, center.y - 4);
    ctx.lineTo(center.x, center.y + 4);
    ctx.stroke();
  };

  const drawRectPreview = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const ctx = ensurePreviewCtx();
    if (!ctx) return;
    ctx.globalAlpha = 0.55;
    fillRectCorners(ctx, a, b);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    ctx.strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  };

  /** Edit-pixel → meters using map.yaml resolution (nav m/px) and editScale. */
  const editPixelsToMeters = (dx: number, dy: number): number => {
    const navMpp = mapMeta?.metersPerPixel ?? 0.05;
    const mpp = navMpp / Math.max(1, editScale);
    return Math.hypot(dx, dy) * mpp;
  };

  const drawMeasurePreview = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const ctx = ensurePreviewCtx();
    if (!ctx) return;
    const meters = editPixelsToMeters(b.x - a.x, b.y - a.y);
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcc00';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const label = `${meters.toFixed(2)} m`;
    ctx.font = 'bold 14px sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(mx - tw / 2 - 6, my - 18, tw + 12, 22);
    ctx.fillStyle = '#ffcc00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, mx, my - 7);
    setMeasureLabel(label);
  };

  const wantsPan = (e: ReactPointerEvent): boolean =>
    tool === 'pan' || e.button === 1 || spaceDown.current || e.buttons === 4;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (wantsPan(e)) {
      panning.current = true;
      drawing.current = false;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewPanRef.current.x,
        panY: viewPanRef.current.y,
      };
      return;
    }
    if (e.button !== 0) return;
    const pt = mapPoint(e.clientX, e.clientY);
    drawing.current = true;
    lastPt.current = pt;
    if (tool === 'line' || tool === 'circle' || tool === 'rect' || tool === 'measure') {
      lineStart.current = pt;
      if (tool === 'line') drawLinePreview(pt, pt);
      else if (tool === 'circle') drawCirclePreview(pt, pt);
      else if (tool === 'rect') drawRectPreview(pt, pt);
      else drawMeasurePreview(pt, pt);
      return;
    }
    if (tool === 'paint') {
      pushHistory();
      dab(pt);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (panning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setViewPan({
        x: panStart.current.panX + dx,
        y: panStart.current.panY + dy,
      });
      return;
    }
    const pt = mapPoint(e.clientX, e.clientY);
    if (lineStart.current && drawing.current) {
      if (tool === 'line') {
        drawLinePreview(lineStart.current, pt);
        return;
      }
      if (tool === 'circle') {
        drawCirclePreview(lineStart.current, pt);
        return;
      }
      if (tool === 'rect') {
        drawRectPreview(lineStart.current, pt);
        return;
      }
      if (tool === 'measure') {
        drawMeasurePreview(lineStart.current, pt);
        return;
      }
    }
    if (!drawing.current) return;
    if (tool === 'paint') {
      if (lastPt.current) stroke(lastPt.current, pt);
      lastPt.current = pt;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panning.current) {
      panning.current = false;
      return;
    }
    if (!drawing.current) return;
    drawing.current = false;
    const pt = mapPoint(e.clientX, e.clientY);
    if (lineStart.current && tool === 'measure') {
      const start = lineStart.current;
      const meters = editPixelsToMeters(pt.x - start.x, pt.y - start.y);
      if (meters > 0.001) {
        drawMeasurePreview(start, pt);
        setMeasureLabel(`${meters.toFixed(2)} m`);
      } else {
        clearPreview();
        setMeasureLabel(null);
      }
      lineStart.current = null;
      lastPt.current = null;
      return;
    }
    if (lineStart.current && (tool === 'line' || tool === 'circle' || tool === 'rect')) {
      const start = lineStart.current;
      const dx = pt.x - start.x;
      const dy = pt.y - start.y;
      const ctx = drawRef.current?.getContext('2d');
      if (ctx && dx * dx + dy * dy >= 4) {
        pushHistory();
        ctx.imageSmoothingEnabled = false;
        ctx.globalCompositeOperation = 'source-over';
        if (tool === 'line') stroke(start, pt);
        else if (tool === 'circle') fillCircle(ctx, start, pt);
        else fillRectCorners(ctx, start, pt);
      }
      clearPreview();
      lineStart.current = null;
    }
    lastPt.current = null;
  };

  const onPointerLeave = () => {
    if (!drawing.current && !panning.current) setCursorPos(null);
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const oldZ = viewZoomRef.current;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZ = Math.min(12, Math.max(0.2, oldZ * factor));
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const p = viewPanRef.current;
    // Zoom toward cursor
    const mapX = (mx - p.x) / oldZ;
    const mapY = (my - p.y) / oldZ;
    setViewZoom(newZ);
    setViewPan({
      x: mx - mapX * newZ,
      y: my - mapY * newZ,
    });
  };

  const clearDrawing = () => {
    resetDrawLayer();
  };

  const bakeOutput = (): {
    width: number;
    height: number;
    pixels: Uint8Array;
    jpgDataUrl: string;
  } => {
    const draw = drawRef.current;
    if (!draw) throw new Error("No canvas");
    const { width, height } = draw;
    const ctx = draw.getContext("2d")!;
    const img = ctx.getImageData(0, 0, width, height);
    const data = img.data;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const gray = rgbToOccupancyGray(data[i]!, data[i + 1]!, data[i + 2]!);
        if (gray !== OCCUPANCY_UNKNOWN) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) {
      minX = 0;
      minY = 0;
      maxX = width - 1;
      maxY = height - 1;
    }
    const pad = 4;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const outW = maxX - minX + 1;
    const outH = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const octx = out.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    octx.fillStyle = RVIZ_UNKNOWN_CSS;
    octx.fillRect(0, 0, outW, outH);
    octx.drawImage(draw, minX, minY, outW, outH, 0, 0, outW, outH);
    const outImg = octx.getImageData(0, 0, outW, outH);
    const pixels = new Uint8Array(outW * outH);
    for (let i = 0; i < outW * outH; i++) {
      const o = i * 4;
      pixels[i] = rgbToOccupancyGray(
        outImg.data[o]!,
        outImg.data[o + 1]!,
        outImg.data[o + 2]!,
      );
    }
    // JPG for RMF uses RViz colors (matches editor / Map display).
    const hard = octx.createImageData(outW, outH);
    for (let i = 0; i < pixels.length; i++) {
      const [r, g, b] =
        pixels[i] === OCCUPANCY_OCCUPIED
          ? [0, 0, 0]
          : pixels[i] === OCCUPANCY_FREE
            ? [255, 255, 255]
            : [0x70, 0x89, 0x86];
      hard.data[i * 4] = r;
      hard.data[i * 4 + 1] = g;
      hard.data[i * 4 + 2] = b;
      hard.data[i * 4 + 3] = 255;
    }
    octx.putImageData(hard, 0, 0);
    return {
      width: outW,
      height: outH,
      pixels,
      jpgDataUrl: out.toDataURL("image/jpeg", 0.95),
    };
  };

  const saveClean = async () => {
    if (!selected || !mapMeta) return;
    const level = selected;
    const resMpp = mapMeta.metersPerPixel;
    setBusy(true);
    setBusyLabel("Saving map…");
    setError(null);
    setMsg(null);
    try {
      const { width, height, pixels, jpgDataUrl } = bakeOutput();
      // Preserve aspect after rotation/crop — never force old navW×navH (that skews).
      const navW = Math.max(1, Math.round(width / editScale));
      const navH = Math.max(1, Math.round(height / editScale));
      const pixelsBase64 = (() => {
        const bytes = pixels;
        const chunk = 0x8000;
        const parts: string[] = [];
        for (let i = 0; i < bytes.length; i += chunk) {
          const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
          parts.push(String.fromCharCode.apply(null, Array.from(slice)));
        }
        return btoa(parts.join(""));
      })();

      const saved = await api.put<{
        navWidth?: number;
        navHeight?: number;
        editWidth?: number;
        editHeight?: number;
      }>(`/api/v1/levels/${level.id}/map-edit`, {
        width,
        height,
        pixelsBase64,
        jpgBase64: jpgDataUrl,
        editScale,
        navWidth: navW,
        navHeight: navH,
        resolution: resMpp,
        originX: mapMeta.originX,
        originY: mapMeta.originY,
      });

      const expectW = saved.navWidth ?? navW;
      const expectH = saved.navHeight ?? navH;

      // Hide stale canvas so we never show half-old / half-new pixels.
      setBusyLabel("Waiting for server files…");
      sourceRef.current = null;
      setMapMeta(null);
      setNavSize({ w: 0, h: 0 });
      {
        const draw = drawRef.current;
        if (draw) {
          const ctx = draw.getContext("2d");
          if (ctx) {
            ctx.fillStyle = RVIZ_UNKNOWN_CSS;
            ctx.fillRect(0, 0, draw.width, draw.height);
          }
        }
        clearPreview();
        clearHistory();
      }

      // Poll occupancy until PGM size matches what we just saved.
      const deadline = Date.now() + 20000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const occ = await api.get<{ pgmBase64: string }>(
            `/api/v1/levels/${level.id}/occupancy`,
          );
          const raw = atob(occ.pgmBase64);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          const decoded = decodePgm(bytes.buffer);
          if (decoded.width === expectW && decoded.height === expectH) {
            ready = true;
            break;
          }
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      if (!ready) {
        throw new Error(
          `Server map not ready (expected ${expectW}×${expectH}). Try Reload in a moment.`,
        );
      }

      setBusyLabel("Reloading map…");
      reloadLevels();
      await loadLevel(level);
      setMsg(`Map saved (${expectW}×${expectH} @ ${resMpp} m/px).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  };

  const fileName = mapMeta?.occupancyMapPath
    ? (mapMeta.occupancyMapPath.split("/").pop() ?? mapMeta.occupancyMapPath)
    : "—";

  const cursor =
    tool === 'pan' || spaceDown.current
      ? panning.current
        ? 'grabbing'
        : 'grab'
      : tool === 'circle' || tool === 'rect' || tool === 'measure'
        ? 'crosshair'
        : 'none';

  const brushScreenPx = Math.max(4, brush * viewZoom);
  const showBrushCursor = tool === 'paint' || tool === 'line';
  const showShapeCursor = tool === 'circle' || tool === 'rect' || tool === 'measure';

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        width: "100%",
        boxSizing: "border-box",
        gap: 1.5,
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", md: "center" }}
        justifyContent="space-between"
        sx={{ flexShrink: 0 }}
      >
        <Box sx={{ minWidth: 0 }}>
          {!embedded && (
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
              Clean map
            </Typography>
          )}
          <Typography
            variant={embedded ? "subtitle1" : "body2"}
            color="text.secondary"
            sx={{ fontWeight: embedded ? 600 : 400 }}
          >
            Paint free / obstacle / unknown, Measure uses map.yaml resolution.
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 0.75 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={fileName}
            />
            {mapMeta && (
              <Chip
                size="small"
                variant="outlined"
                label={`${mapMeta.metersPerPixel} m/px`}
              />
            )}
            {navSize.w > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`${navSize.w}×${navSize.h}`}
              />
            )}
            {mapMeta && (
              <Chip
                size="small"
                variant="outlined"
                label={`${mapMeta.metersPerPixel} m/px`}
              />
            )}
            {measureLabel && (
              <Chip size="small" color="warning" label={measureLabel} />
            )}
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="clean-level">Floor</InputLabel>
            <Select
              labelId="clean-level"
              label="Floor"
              value={selected?.id ?? ""}
              onChange={(e) => setLevelId(String(e.target.value))}
            >
              {(levels ?? []).map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            size="small"
            disabled={!selected || busy}
            onClick={() => selected && void loadLevel(selected)}
          >
            Reload
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={mapSize.w < 1}
            onClick={() => fitView(mapSize.w, mapSize.h)}
          >
            Fit
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={mapSize.w < 1}
            onClick={() => {
              setViewZoom(1);
              setViewPan({ x: 40, y: 40 });
            }}
          >
            1:1
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={undo}
            disabled={busy || !canUndo}
          >
            Undo
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={clearDrawing}
            disabled={busy}
          >
            Reset edits
          </Button>
          <Button
            variant="contained"
            size="small"
            disabled={!selected || !mapMeta || busy}
            onClick={() => void saveClean()}
            startIcon={
              busy ? <CircularProgress size={14} color="inherit" /> : undefined
            }
          >
            {busy ? (busyLabel ?? "Working…") : "Save clean map"}
          </Button>
        </Stack>
      </Stack>

      {(levelsErr || error) && (
        <Alert
          severity="error"
          onClose={() => setError(null)}
          sx={{ flexShrink: 0 }}
        >
          {levelsErr ?? error}
        </Alert>
      )}
      {msg && (
        <Alert
          severity="success"
          onClose={() => setMsg(null)}
          sx={{ flexShrink: 0 }}
        >
          {msg}
        </Alert>
      )}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
        sx={{ flexShrink: 0 }}
        flexWrap="wrap"
        useFlexGap
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={tool}
          onChange={(_e, v: Tool | null) => {
            if (!v) return;
            clearPreview();
            lineStart.current = null;
            drawing.current = false;
            if (v !== 'measure') setMeasureLabel(null);
            setTool(v);
          }}
        >
          <ToggleButton value="paint">Brush</ToggleButton>
          <ToggleButton value="line">Line</ToggleButton>
          <ToggleButton value="circle">Circle</ToggleButton>
          <ToggleButton value="rect">Rect</ToggleButton>
          <ToggleButton value="measure">Measure</ToggleButton>
          <ToggleButton value="pan">Pan</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={paintColor}
          onChange={(_e, v: OccupancyBrush | null) => v && setPaintColor(v)}
          disabled={tool === "pan" || tool === "measure"}
        >
          <ToggleButton value="obstacle" sx={{ gap: 0.75 }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                bgcolor: RVIZ_OCCUPIED_CSS,
                border: "1px solid",
                borderColor: "divider",
              }}
            />
            Obstacle
          </ToggleButton>
          <ToggleButton value="free" sx={{ gap: 0.75 }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                bgcolor: RVIZ_FREE_CSS,
                border: "1px solid",
                borderColor: "divider",
              }}
            />
            Free
          </ToggleButton>
          <ToggleButton value="unknown" sx={{ gap: 0.75 }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                bgcolor: RVIZ_UNKNOWN_CSS,
                border: "1px solid",
                borderColor: "divider",
              }}
            />
            Unknown
          </ToggleButton>
        </ToggleButtonGroup>
        <ButtonGroup size="small" variant="outlined">
          <Button
            onClick={() => {
              setRotation((r) => r - 90);
            }}
          >
            −90°
          </Button>
          <Button onClick={() => setRotation(0)}>0°</Button>
          <Button onClick={() => setRotation((r) => r + 90)}>+90°</Button>
        </ButtonGroup>
        <Box sx={{ width: 200, px: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Rotate map {rotation.toFixed(1)}°
          </Typography>
          <Slider
            size="small"
            min={-180}
            max={180}
            step={0.5}
            value={rotation}
            onChange={(_e, v) => setRotation(Array.isArray(v) ? v[0]! : v)}
          />
        </Box>
        <Box sx={{ width: 160, px: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Brush {brush}px
          </Typography>
          <Slider
            size="small"
            min={1}
            max={64}
            value={brush}
            onChange={(_e, v) => setBrush(Array.isArray(v) ? v[0]! : v)}
          />
        </Box>
        <Box sx={{ width: 120, px: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Original overlay
          </Typography>
          <Slider
            size="small"
            min={0}
            max={1}
            step={0.05}
            value={guideOpacity}
            onChange={(_e, v) => setGuideOpacity(Array.isArray(v) ? v[0]! : v)}
          />
        </Box>
      </Stack>

      <Box
        ref={viewportRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        sx={{
          flex: 1,
          minHeight: 0,
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: RVIZ_UNKNOWN_CSS,
          overflow: "hidden",
          position: "relative",
          cursor: busy ? "wait" : cursor,
          touchAction: "none",
          pointerEvents: busy ? "none" : "auto",
        }}
      >
        <Box
          ref={stageRef}
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            width: mapSize.w,
            height: mapSize.h,
            transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewZoom})`,
            transformOrigin: "0 0",
            willChange: "transform",
            visibility: busy ? "hidden" : "visible",
          }}
        >
          <canvas
            ref={drawRef}
            width={mapSize.w}
            height={mapSize.h}
            style={{
              position: "absolute",
              inset: 0,
              width: mapSize.w,
              height: mapSize.h,
              imageRendering: "pixelated",
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={previewRef}
            width={mapSize.w}
            height={mapSize.h}
            style={{
              position: "absolute",
              inset: 0,
              width: mapSize.w,
              height: mapSize.h,
              imageRendering: "pixelated",
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={guideRef}
            width={mapSize.w}
            height={mapSize.h}
            style={{
              position: "absolute",
              inset: 0,
              width: mapSize.w,
              height: mapSize.h,
              imageRendering: "pixelated",
              pointerEvents: "none",
            }}
          />
        </Box>
        {cursorPos && showBrushCursor && !busy && (
          <Box
            sx={{
              position: 'absolute',
              left: cursorPos.x,
              top: cursorPos.y,
              width: brushScreenPx,
              height: brushScreenPx,
              ml: `${-brushScreenPx / 2}px`,
              mt: `${-brushScreenPx / 2}px`,
              borderRadius: '50%',
              // Always high-contrast: black ring + white fill (visible on any map color).
              border: '2px solid #000',
              boxShadow: '0 0 0 2px #fff, inset 0 0 0 1px rgba(0,0,0,0.35)',
              bgcolor: 'rgba(255,255,255,0.85)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        )}
        {cursorPos && showShapeCursor && !busy && (
          <Box
            sx={{
              position: 'absolute',
              left: cursorPos.x,
              top: cursorPos.y,
              width: 18,
              height: 18,
              ml: '-9px',
              mt: '-9px',
              pointerEvents: 'none',
              zIndex: 5,
              '&::before': {
                content: '""',
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                width: 2,
                ml: '-1px',
                bgcolor: '#000',
                boxShadow: '0 0 0 1px #fff',
              },
              '&::after': {
                content: '""',
                position: 'absolute',
                top: '50%',
                left: 0,
                right: 0,
                height: 2,
                mt: '-1px',
                bgcolor: '#000',
                boxShadow: '0 0 0 1px #fff',
              },
            }}
          />
        )}
        {busy && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1.5,
              bgcolor: "rgba(32, 40, 40, 0.72)",
            }}
          >
            <CircularProgress size={36} />
            <Typography variant="body2" sx={{ color: "#fff", fontWeight: 600 }}>
              {busyLabel ?? "Working…"}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
