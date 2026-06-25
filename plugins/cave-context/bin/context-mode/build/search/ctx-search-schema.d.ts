/**
 * ctx_search input-schema builder and project-scope resolver.
 *
 * Issue #737 introduces the optional `project:` parameter used by callers
 * running in the shared-DB mode (`CONTEXT_MODE_PROJECT_DIR` is set). The
 * field is registered conditionally so that in the default per-project DB
 * mode the LLM physically cannot pass it — the parameter does not exist
 * in the tool schema at all, which is a stronger guarantee than runtime
 * validation that depends on the model honouring documentation.
 *
 * The handler in `src/server.ts` consumes both exports:
 *   - {@link buildCtxSearchInputSchema} composes the Zod object used at
 *     `registerTool` time, spreading the conditional `project` field only
 *     when `isSharedMode` is true.
 *   - {@link resolveProjectScope} normalises the raw param into the
 *     three-state contract consumed by `searchAllSources`:
 *       undefined → no filter
 *       null      → explicit cross-project recall (no filter)
 *       string    → restrict to that project directory
 */
import { z } from "zod";
/**
 * Build the Zod object passed to `server.registerTool("ctx_search", …)`.
 *
 * The base fields (`queries`, `limit`, `source`, `contentType`, `sort`)
 * are always present and mirror today's contract exactly. The `project`
 * field is only spread in when `isSharedMode` is true. When the host runs
 * with the default per-project DB layout the schema does not expose the
 * field at all, which keeps the tool surface honest about what is
 * actionable in that mode.
 */
export declare function buildCtxSearchInputSchema(isSharedMode: boolean): z.ZodObject<{
    queries: z.ZodEffects<z.ZodOptional<z.ZodArray<z.ZodString, "many">>, string[] | undefined, unknown>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    source: z.ZodOptional<z.ZodString>;
    contentType: z.ZodOptional<z.ZodEnum<["code", "prose"]>>;
    sort: z.ZodDefault<z.ZodOptional<z.ZodEnum<["relevance", "timeline"]>>>;
} | {
    project: z.ZodOptional<z.ZodString>;
    queries: z.ZodEffects<z.ZodOptional<z.ZodArray<z.ZodString, "many">>, string[] | undefined, unknown>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    source: z.ZodOptional<z.ZodString>;
    contentType: z.ZodOptional<z.ZodEnum<["code", "prose"]>>;
    sort: z.ZodDefault<z.ZodOptional<z.ZodEnum<["relevance", "timeline"]>>>;
}, "strip", z.ZodTypeAny, {
    sort: "relevance" | "timeline";
    limit: number;
    source?: string | undefined;
    contentType?: "code" | "prose" | undefined;
    queries?: string[] | undefined;
} | {
    sort: "relevance" | "timeline";
    limit: number;
    source?: string | undefined;
    contentType?: "code" | "prose" | undefined;
    queries?: string[] | undefined;
    project?: unknown;
}, {
    sort?: "relevance" | "timeline" | undefined;
    source?: string | undefined;
    limit?: number | undefined;
    contentType?: "code" | "prose" | undefined;
    queries?: unknown;
} | {
    sort?: "relevance" | "timeline" | undefined;
    source?: string | undefined;
    limit?: number | undefined;
    contentType?: "code" | "prose" | undefined;
    queries?: unknown;
    project?: unknown;
}>;
/**
 * Normalise the raw `project` value into the three-state contract consumed
 * by {@link searchAllSources}.
 *
 *   - shared mode OFF                        → `undefined` (param ignored)
 *   - shared mode ON, param `undefined`      → current project (`getProjectDirFn()`)
 *   - shared mode ON, param `"global"`       → `null` (no filter — cross-project)
 *   - shared mode ON, param `<string>`       → that string verbatim
 *
 * The function is pure so it stays trivially testable without spinning up
 * the MCP server.
 */
export declare function resolveProjectScope(raw: string | undefined, isSharedMode: boolean, getProjectDirFn: () => string): string | null | undefined;
/**
 * Module-load snapshot of `CONTEXT_MODE_PROJECT_DIR`. Captured once so the
 * tool schema registered with `server.registerTool` reflects the launch
 * environment — the LLM-visible surface should never flip mid-session.
 */
export declare const CTX_SEARCH_SHARED_MODE: boolean;
