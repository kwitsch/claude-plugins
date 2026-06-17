// Native self-heal + GC for cave-context's OWN versioned plugin cache. context-mode's
// heal/GC targets context-mode's plugin-cache deployment, which is absent under
// cave-context's npm-package upstream model — so this is reimplemented natively.
import { readdirSync, lstatSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

const ONE_HOUR_MS = 3600000;

// {parent: dir holding version dirs, current: this version's dir name} from a plugin
// root like .../plugins/cache/<mp>/cave-context/<version>. null if not such a path.
export function resolveCacheLayout(pluginRoot) {
  if (!pluginRoot || typeof pluginRoot !== "string") return null;
  const current = basename(pluginRoot);
  const parent = dirname(pluginRoot);
  if (!/[/\\]plugins[/\\]cache[/\\].+[/\\]cave-context$/.test(parent)) return null;
  return { parent, current };
}

// Delete sibling version dirs older than 1h (lstat mtime) except current.
export function gcOldVersions(pluginRoot, now) {
  const layout = resolveCacheLayout(pluginRoot);
  if (!layout) return [];
  const removed = [];
  let entries;
  try { entries = readdirSync(layout.parent); } catch { return []; }
  for (const name of entries) {
    if (name === layout.current) continue;
    const dir = resolve(layout.parent, name);
    try {
      const st = lstatSync(dir);   // lstat: a fresh symlink to an old target keeps its OWN mtime
      if (now - st.mtimeMs > ONE_HOUR_MS) {
        rmSync(dir, { recursive: true, force: true });
        removed.push(name);
      }
    } catch { /* skip unreadable entry */ }
  }
  return removed;
}

// Best-effort entry point — never throws.
export function healCache(pluginRoot, now = Date.now()) {
  try { return { removed: gcOldVersions(pluginRoot, now) }; }
  catch { return { removed: [] }; }
}
