import type { EngineInterface, Register } from "claude-code";
import { CONFIG_PATHS, dprintCandidates, isEnabled, missingDprintWarning } from "./detect.mjs";

// Whether `path` is a regular file (links followed); any error means no.
// shortcut: FsStat has no mode bits, so a non-executable `dprint` file counts as installed (check-dprint.mjs also tests X_OK); upgrade when $.fs.stat exposes a mode.
async function isFile($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.stat(path).then(
    (s) => s.kind === "file",
    () => false,
  );
}

// The first of `paths` that is a regular file, else undefined.
async function firstFile($: EngineInterface, paths: string[]): Promise<string | undefined> {
  for (const p of paths) if (await isFile($, p)) return p;
  return undefined;
}

export const register: Register = (on, options) => {
  if (!isEnabled(options.warn_missing_dprint)) return;
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    if (!e.isInteractive) return r; // -p / SDK: nobody to see a toast
    try {
      const rel = await firstFile(
        $,
        CONFIG_PATHS.map((p) => `${e.cwd}/${p}`),
      );
      if (rel === undefined) return r;
      const bin = await firstFile($, dprintCandidates(await $.env.get("PATH"), await $.env.get("HOME")));
      if (bin === undefined)
        $.ui.toast(missingDprintWarning(rel.slice(e.cwd.length + 1)), {
          timeoutMs: 10_000,
        });
    } catch {
      // fail open: a probe or toast hiccup never touches session start
    }
    return r;
  });
};
