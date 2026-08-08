// util.ts — the unbounded filesystem walker and the process-lifetime PATH probe cache.
import path from "node:path";
import process from "node:process";
import { accessSync, constants as fsConstants } from "node:fs";

// Walk from `dir` up to the filesystem root (inclusive), calling `checkDir` at each level;
// true on the first hit. Unbounded -- unlike editorconfig.ts's walkers (findNativeConfig,
// resolveEditorconfig), which stop at `cwd` because their governing tools (ruff/black/
// .editorconfig) only ever look inside the project tree. Prettier's own config search has no
// such bound (verified against prettier's source: its CONFIG_FILES searcher has no
// stopDirectory), so bounding this one at `cwd` would misdetect "absent" for a real config
// living above the project root (a workspace/monorepo case).
export function walkToRoot(dir: string, checkDir: (dir: string) => boolean): boolean {
  for (;;) {
    if (checkDir(dir)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// PATH probe cache (process-lifetime): tool name -> boolean on PATH. Module-level singleton:
// bun emits this module once, so both handlers share the one cache exactly as before.
const probeCache = new Map<string, boolean>();

/** True when `tool` is an executable on PATH. Cached for the process lifetime. */
export function onPath(tool: string): boolean {
  const cached = probeCache.get(tool);
  if (cached !== undefined) return cached;
  let found = false;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, tool), fsConstants.X_OK);
      found = true;
      break;
    } catch {
      /* keep looking */
    }
  }
  probeCache.set(tool, found);
  return found;
}
