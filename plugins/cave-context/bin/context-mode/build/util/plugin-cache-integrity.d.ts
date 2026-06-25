/**
 * TypeScript surface for the start.mjs plugin-cache integrity helper.
 *
 * The actual logic lives in `scripts/plugin-cache-integrity.mjs` (raw
 * `.mjs` so start.mjs can import it without a TS toolchain at boot —
 * #550 fail-fast happens BEFORE any bundle is loaded). This module is
 * the bridge that lets TS consumers (claude-code adapter's
 * getHealthChecks for Algo-D5, the cli doctor surface) call the same
 * function without duplicating the implementation.
 *
 * Single source of truth: scripts/plugin-cache-integrity.mjs. Boot
 * fail-fast (Algo-D4) and doctor diagnostic (Algo-D5) agree
 * byte-for-byte because they call the same exported function.
 *
 * Top-level dynamic import is used (not a static `import` from `.mjs`)
 * because the project is ESM and `import` of a sibling `.mjs` from a
 * `.ts` file relies on the bundler / loader resolving `.mjs`
 * extensions, which esbuild can do but tsc-only typecheck cannot. The
 * dynamic import is resolved by the runtime (Node ESM) regardless of
 * how the consumer was bundled. Errors are caught and surfaced as a
 * FAIL detail — the helper is required to ship in the npm tarball
 * (package.json files[]); a missing helper means the install is
 * fundamentally broken.
 */
/**
 * Files `start.mjs` needs to launch the MCP server, checked dependency-free
 * (fs only) so this works even when the integrity helper
 * (`scripts/plugin-cache-integrity.mjs`) is itself missing — a missing helper
 * is itself a partial-install symptom, and the operator most needs to know
 * whether the launch entrypoint survived.
 *
 * - `start.mjs` is the plugin `command` target (`.claude-plugin/plugin.json`)
 *   and has NO fallback: if absent, `node ${CLAUDE_PLUGIN_ROOT}/start.mjs`
 *   fails immediately and the MCP server never starts.
 * - The server is loaded by start.mjs from `server.bundle.mjs`, falling back
 *   to `build/server.js`; it is only "missing" when BOTH are absent.
 */
export declare function findMissingLaunchFiles(pluginRoot: string): string[];
/**
 * Run the integrity check synchronously. If the helper module is
 * still loading (not yet cached) returns a FAIL with detail
 * "integrity helper not yet loaded" — caller should retry once the
 * doctor command's IO is complete. In practice the doctor is invoked
 * many MS after module load so this fallback is defensive only.
 */
export declare function checkPluginCacheIntegritySync(pluginRoot: string): {
    status: "OK" | "FAIL";
    detail: string;
};
/** Force-await the helper load. Tests use this to deflake the eager fire-and-forget. */
export declare function ensurePluginCacheIntegrityLoaded(): Promise<void>;
