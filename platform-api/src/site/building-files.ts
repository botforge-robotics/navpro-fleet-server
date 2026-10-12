import { promises as fs } from "fs";
import path from "path";
import { config } from "../config";

/** Legacy name used by traffic-editor docs / older scripts. */
export const BUILDING_YAML_LEGACY = "building.yaml";

/**
 * Filename RMF `building_map_server` accepts. Plain `building.yaml` fatals with
 * "unknown filename suffix" and leaves GET /rmf/building_map → 404.
 */
export const BUILDING_YAML_RMF = "site.building.yaml";

/** Write both legacy + RMF-suffixed copies atomically. */
export async function writeBuildingYamlFiles(yamlText: string): Promise<string> {
  await fs.mkdir(config.siteDir, { recursive: true });
  const rmfPath = path.join(config.siteDir, BUILDING_YAML_RMF);
  const legacyPath = path.join(config.siteDir, BUILDING_YAML_LEGACY);
  const stamp = `${process.pid}-${Date.now()}`;
  for (const outPath of [rmfPath, legacyPath]) {
    const tmp = `${outPath}.tmp-${stamp}`;
    await fs.writeFile(tmp, yamlText, "utf8");
    await fs.rename(tmp, outPath);
  }
  return rmfPath;
}

/** Prefer *.building.yaml; fall back to legacy building.yaml. */
export async function resolveBuildingYamlPath(): Promise<string | null> {
  const rmfPath = path.join(config.siteDir, BUILDING_YAML_RMF);
  try {
    await fs.access(rmfPath);
    return rmfPath;
  } catch {
    /* continue */
  }
  try {
    const entries = await fs.readdir(config.siteDir);
    const match = entries.find((e) => e.endsWith(".building.yaml"));
    if (match !== undefined) return path.join(config.siteDir, match);
  } catch {
    /* continue */
  }
  const legacyPath = path.join(config.siteDir, BUILDING_YAML_LEGACY);
  try {
    await fs.access(legacyPath);
    return legacyPath;
  } catch {
    return null;
  }
}
