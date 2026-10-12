// Minimal recursive JSON diff used by the workflow version viewer.
// Produces flat "path: before -> after" lines; good enough for operators to
// see what changed between two workflow versions.

export interface DiffLine {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

function fmt(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function jsonDiff(a: unknown, b: unknown, path = ''): DiffLine[] {
  if (a === undefined && b !== undefined) {
    return [{ path, kind: 'added', after: fmt(b) }];
  }
  if (a !== undefined && b === undefined) {
    return [{ path, kind: 'removed', before: fmt(a) }];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const lines: DiffLine[] = [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      lines.push(...jsonDiff(a[i], b[i], `${path}[${i}]`));
    }
    return lines;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const lines: DiffLine[] = [];
    keys.forEach((key) => {
      lines.push(...jsonDiff(a[key], b[key], path === '' ? key : `${path}.${key}`));
    });
    return lines;
  }
  if (fmt(a) !== fmt(b)) {
    return [{ path, kind: 'changed', before: fmt(a), after: fmt(b) }];
  }
  return [];
}
