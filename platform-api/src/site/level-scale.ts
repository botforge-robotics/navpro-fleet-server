/**
 * Traffic-editor does not read map.yaml resolution. Level scale comes from
 * measurement edges: meters_per_pixel = distance / pixel_length.
 * We inject a named measurement pair so opening the floorplan always has the
 * correct scale from Nav2 map.yaml.
 */
const SCALE_A = "navpro_scale_a";
const SCALE_B = "navpro_scale_b";

type VertexRow = unknown[];
type EdgeRow = unknown[];

function vertexName(v: unknown): string {
  if (!Array.isArray(v) || v.length < 4) return "";
  return String(v[3] ?? "");
}

function isScaleVertex(v: unknown): boolean {
  const n = vertexName(v);
  return n === SCALE_A || n === SCALE_B;
}

/** Remap edge endpoint indices after removing some vertices. */
function remapEdge(edge: unknown, oldToNew: Map<number, number>): EdgeRow | null {
  if (!Array.isArray(edge) || edge.length < 2) return null;
  const a = Number(edge[0]);
  const b = Number(edge[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (!oldToNew.has(a) || !oldToNew.has(b)) return null;
  const next = [...edge] as EdgeRow;
  next[0] = oldToNew.get(a)!;
  next[1] = oldToNew.get(b)!;
  return next;
}

function remapEdgeList(
  list: unknown,
  oldToNew: Map<number, number>,
): EdgeRow[] {
  if (!Array.isArray(list)) return [];
  const out: EdgeRow[] = [];
  for (const e of list) {
    const remapped = remapEdge(e, oldToNew);
    if (remapped) out.push(remapped);
  }
  return out;
}

/**
 * Ensure level has a measurement that encodes `metersPerPixel` for traffic-editor.
 * Replaces prior measurements (map.yaml resolution is authoritative for SLAM maps).
 * Preserves non-scale vertices / lanes / walls / doors.
 */
export function upsertLevelScaleFromResolution(
  level: Record<string, unknown>,
  metersPerPixel: number,
  imageWidthPx: number,
): void {
  const mpp =
    Number.isFinite(metersPerPixel) && metersPerPixel > 0
      ? metersPerPixel
      : 0.05;
  const spanPx = Math.max(
    10,
    Math.min(100, Math.max(1, Math.floor(imageWidthPx * 0.5))),
  );
  const distanceM = spanPx * mpp;

  const vertsIn = Array.isArray(level.vertices) ? (level.vertices as VertexRow[]) : [];
  const oldToNew = new Map<number, number>();
  const kept: VertexRow[] = [];
  for (let i = 0; i < vertsIn.length; i++) {
    const v = vertsIn[i]!;
    if (isScaleVertex(v)) continue;
    oldToNew.set(i, kept.length);
    kept.push(v);
  }

  // Remap graph edges; drop anything that referenced removed scale verts.
  level.lanes = remapEdgeList(level.lanes, oldToNew);
  level.walls = remapEdgeList(level.walls, oldToNew);
  level.doors = remapEdgeList(level.doors, oldToNew);

  const ia = kept.length;
  const ib = ia + 1;
  // Place along top edge so it does not clutter the map center.
  kept.push([0, 0, 0, SCALE_A]);
  kept.push([spanPx, 0, 0, SCALE_B]);
  level.vertices = kept;

  // ParamValue double = [3, value] in traffic-editor YAML.
  // Only this measurement — averaging with hand-drawn lines would skew scale.
  level.measurements = [[ia, ib, { distance: [3, distanceM] }]];
}
