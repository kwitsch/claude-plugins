/**
 * adapters/client-map — MCP clientInfo.name → PlatformId mapping.
 *
 * Source: Apify MCP Client Capabilities Registry
 * https://github.com/apify/mcp-client-capabilities
 *
 * Only includes platforms we have adapters for.
 */
import type { PlatformId } from "./types.js";
export declare const CLIENT_NAME_TO_PLATFORM: Record<string, PlatformId>;
