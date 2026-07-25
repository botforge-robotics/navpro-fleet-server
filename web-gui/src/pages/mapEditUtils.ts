/** ROS map_saver trinary unknown gray (typical PGM value). */
export const OCCUPANCY_UNKNOWN = 205;
export const OCCUPANCY_FREE = 255;
export const OCCUPANCY_OCCUPIED = 0;

/** RViz Map display palette (makeMapPalette): unknown = legal -1. */
export const RVIZ_FREE_RGB = [255, 255, 255] as const;
export const RVIZ_OCCUPIED_RGB = [0, 0, 0] as const;
export const RVIZ_UNKNOWN_RGB = [0x70, 0x89, 0x86] as const; // #708986

export const RVIZ_FREE_CSS = `rgb(${RVIZ_FREE_RGB.join(',')})`;
export const RVIZ_OCCUPIED_CSS = `rgb(${RVIZ_OCCUPIED_RGB.join(',')})`;
export const RVIZ_UNKNOWN_CSS = `rgb(${RVIZ_UNKNOWN_RGB.join(',')})`;

/** @deprecated PGM gray CSS — prefer RViz CSS for UI rendering. */
export const OCCUPANCY_UNKNOWN_CSS = RVIZ_UNKNOWN_CSS;
export const OCCUPANCY_FREE_CSS = RVIZ_FREE_CSS;
export const OCCUPANCY_OCCUPIED_CSS = RVIZ_OCCUPIED_CSS;

export type OccupancyBrush = 'free' | 'obstacle' | 'unknown';

/** Brush paint color in RViz Map display style. */
export function brushCss(color: OccupancyBrush): string {
  if (color === 'free') return RVIZ_FREE_CSS;
  if (color === 'obstacle') return RVIZ_OCCUPIED_CSS;
  return RVIZ_UNKNOWN_CSS;
}

export function brushGray(color: OccupancyBrush): number {
  if (color === 'free') return OCCUPANCY_FREE;
  if (color === 'obstacle') return OCCUPANCY_OCCUPIED;
  return OCCUPANCY_UNKNOWN;
}

/** Map PGM gray → RViz Map palette RGB (trinary). */
export function pgmGrayToRviz(v: number): readonly [number, number, number] {
  if (v < 128) return RVIZ_OCCUPIED_RGB;
  if (v >= 240) return RVIZ_FREE_RGB;
  return RVIZ_UNKNOWN_RGB;
}

/** Classify an editor pixel (RViz or grayscale) back to PGM occupancy. */
export function rgbToOccupancyGray(r: number, g: number, b: number): number {
  const dr = r - RVIZ_UNKNOWN_RGB[0];
  const dg = g - RVIZ_UNKNOWN_RGB[1];
  const db = b - RVIZ_UNKNOWN_RGB[2];
  if (dr * dr + dg * dg + db * db < 45 * 45) return OCCUPANCY_UNKNOWN;
  const lum = (r + g + b) / 3;
  if (lum < 128) return OCCUPANCY_OCCUPIED;
  if (lum >= 240) return OCCUPANCY_FREE;
  // Mid gray (PGM 205) or soft values → unknown
  if (Math.abs(lum - OCCUPANCY_UNKNOWN) <= 40) return OCCUPANCY_UNKNOWN;
  return lum < 180 ? OCCUPANCY_OCCUPIED : OCCUPANCY_FREE;
}

/** Decode binary PGM (P5) from ArrayBuffer → ImageData-compatible gray + size. */
export function decodePgm(buf: ArrayBuffer): { width: number; height: number; pixels: Uint8Array } {
  const u8 = new Uint8Array(buf);
  if (u8.length < 8 || u8[0] !== 0x50 || u8[1] !== 0x35) {
    throw new Error('expected binary PGM (P5)');
  }
  let i = 2;
  const skip = (): void => {
    while (i < u8.length && (u8[i] === 0x20 || u8[i] === 0x09 || u8[i] === 0x0a || u8[i] === 0x0d)) {
      i++;
    }
    while (i < u8.length && u8[i] === 0x23) {
      while (i < u8.length && u8[i] !== 0x0a) i++;
      while (i < u8.length && (u8[i] === 0x20 || u8[i] === 0x09 || u8[i] === 0x0a || u8[i] === 0x0d)) {
        i++;
      }
    }
  };
  const token = (): string => {
    skip();
    const start = i;
    while (i < u8.length && u8[i]! > 0x20) i++;
    return String.fromCharCode(...u8.subarray(start, i));
  };
  const width = Number(token());
  const height = Number(token());
  const maxVal = Number(token());
  skip();
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('invalid PGM size');
  }
  if (maxVal !== 255) throw new Error(`unsupported PGM maxval ${maxVal}`);
  const need = width * height;
  if (i + need > u8.length) throw new Error('truncated PGM');
  return { width, height, pixels: u8.subarray(i, i + need) };
}

/**
 * Colorize grayscale occupancy → RViz Map palette canvas (1:1), then
 * nearest-neighbor upscale via drawImage (avoids huge manual pixel loops).
 */
export function grayToUpscaledImage(
  pixels: Uint8Array,
  srcW: number,
  srcH: number,
  scale: number,
): HTMLCanvasElement {
  if (pixels.length < srcW * srcH) {
    throw new Error(`pixel buffer ${pixels.length} < ${srcW * srcH}`);
  }
  const s = Math.max(1, Math.round(scale));
  const native = document.createElement('canvas');
  native.width = srcW;
  native.height = srcH;
  const nctx = native.getContext('2d', { willReadFrequently: true });
  if (!nctx) throw new Error('2d context unavailable');
  const img = nctx.createImageData(srcW, srcH);
  const data = img.data;
  for (let i = 0; i < srcW * srcH; i++) {
    const [r, g, b] = pgmGrayToRviz(pixels[i]!);
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);

  if (s === 1) return native;

  const up = document.createElement('canvas');
  up.width = srcW * s;
  up.height = srcH * s;
  const uctx = up.getContext('2d');
  if (!uctx) throw new Error('2d context unavailable');
  uctx.imageSmoothingEnabled = false;
  uctx.drawImage(native, 0, 0, up.width, up.height);
  return up;
}

/** Edit scale so ~1 cm per edit pixel when yaml resolution is meters/px. */
export function editScaleFromResolution(metersPerPixel: number): number {
  const target = 0.01; // 1 cm / edit-px for comfortable tracing
  const scale = Math.round(metersPerPixel / target);
  return Math.min(8, Math.max(2, scale || 2));
}
