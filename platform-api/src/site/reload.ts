import fs from "fs/promises";
import path from "path";
import { config } from "../config";

/** Ask rmf-core to bounce (consumed by scripts/watch_reload_rmf.sh / rmf-reloader). */
export async function touchReloadFlag(): Promise<void> {
  const flagPath = path.join(config.siteDir, ".reload-requested");
  await fs.writeFile(flagPath, new Date().toISOString(), "utf8");
}

/** Ask traffic-editor to relaunch Qt so it reloads floorplan.png. */
export async function touchTrafficEditorReload(): Promise<void> {
  const flagPath = path.join(config.siteDir, ".traffic-editor-reload");
  await fs.writeFile(flagPath, `${Date.now()}\n`, "utf8");
}
