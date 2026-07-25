/** Minimal PGM (P5) → PNG encoder (no native deps). */
import { deflateSync } from "zlib";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Parse binary PGM (P5) → { width, height, pixels (row-major, 0–255) }. */
export function parsePgm(buf: Buffer): {
  width: number;
  height: number;
  pixels: Buffer;
} {
  if (buf.length < 8 || buf[0] !== 0x50 || buf[1] !== 0x35) {
    throw new Error("expected binary PGM (P5)");
  }
  let i = 2;
  const skip = (): void => {
    while (
      i < buf.length &&
      (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)
    ) {
      i++;
    }
    while (i < buf.length && buf[i] === 0x23) {
      while (i < buf.length && buf[i] !== 0x0a) i++;
      while (
        i < buf.length &&
        (buf[i] === 0x20 ||
          buf[i] === 0x09 ||
          buf[i] === 0x0a ||
          buf[i] === 0x0d)
      ) {
        i++;
      }
    }
  };
  const readToken = (): string => {
    skip();
    const start = i;
    while (i < buf.length && buf[i]! > 0x20) i++;
    return buf.subarray(start, i).toString("ascii");
  };
  const width = Number(readToken());
  const height = Number(readToken());
  const maxVal = Number(readToken());
  skip();
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error("invalid PGM dimensions");
  }
  if (maxVal !== 255) {
    throw new Error(`unsupported PGM maxval ${maxVal}`);
  }
  const need = width * height;
  if (i + need > buf.length) {
    throw new Error("truncated PGM pixel data");
  }
  return { width, height, pixels: buf.subarray(i, i + need) };
}

/** Encode grayscale pixels as 8-bit PNG. */
export function encodeGrayPng(
  width: number,
  height: number,
  pixels: Buffer,
): Buffer {
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter none
    pixels.copy(raw, row + 1, y * width, y * width + width);
  }
  const compressed = deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function pgmToPng(pgmBuf: Buffer): Buffer {
  const { width, height, pixels } = parsePgm(pgmBuf);
  return encodeGrayPng(width, height, pixels);
}

/** Encode grayscale pixels as binary PGM (P5) for Nav2 / map_server. */
export function encodePgm(width: number, height: number, pixels: Buffer): Buffer {
  if (pixels.length < width * height) {
    throw new Error("pixel buffer shorter than width*height");
  }
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, pixels.subarray(0, width * height)]);
}

/** Nearest-neighbor resize of grayscale buffer (keeps occupancy edges sharp). */
export function resizeGrayNearest(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const out = Buffer.alloc(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * (srcH / dstH)));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * (srcW / dstW)));
      out[y * dstW + x] = src[sy * srcW + sx]!;
    }
  }
  return out;
}
