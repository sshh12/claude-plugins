// server.ts — MCP server harness for generated diy-mcp servers.
// Template file: gets copied into generated MCP servers as server/server.js.
//
// Handles all boilerplate: built-in tools (set_output_dir, debug_env),
// tool assembly, inline param injection, error handling, and stdio wiring.
// The generated index.js only provides META, APP_TOOLS, and handleTool.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { MCPToolResult } from "./types.js";

// -- Types for the public API -------------------------------------------------

interface Meta {
  app: string;
  domain: string;
  displayName: string;
  loginUrl: string;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface OutputModule {
  INLINE_PARAM: Readonly<Record<string, unknown>>;
  setOutputDir(path: string): void;
  getOutputDir(): string | undefined;
}

export interface ServerConfig {
  meta: Meta;
  tools: ToolDef[];
  handleTool: (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>;
  output: OutputModule;
}

// -- Built-in tools -----------------------------------------------------------

const BUILTIN_TOOLS: ToolDef[] = [
  {
    name: "set_output_dir",
    description:
      "Change the directory where large responses are saved as files. " +
      "Call at session start. Use <working_directory>/<app-name>/ (e.g. /Users/me/project/spinach/) " +
      "not the bare working directory — avoid cluttering the user's project root. " +
      "If the project already has an output/ or data/ convention, follow that instead. " +
      "In Cowork: check CLAUDE_CODE_WORKSPACE_HOST_PATHS env var for mounted host paths. " +
      "Returns the resolved path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to output directory (e.g. /Users/me/project/<app-name>/)" },
      },
      required: ["path"],
    },
  },
];

function debugTool(appName: string): ToolDef {
  return {
    name: `${appName}_debug_env`,
    description:
      "Dump server environment: Node.js version, working directory, output dir, inline config. " +
      "Use to diagnose connection or path issues.",
    inputSchema: { type: "object", properties: {} },
  };
}

// -- Public API ---------------------------------------------------------------

/**
 * Start an MCP server with the given app tools and handler.
 * Wires up built-in tools, inline param injection, error handling, and stdio.
 */
export async function startServer({ meta, tools, handleTool, output }: ServerConfig): Promise<void> {
  const allowInlineLarge = process.env.ALLOW_INLINE_LARGE === "true";
  const includeDebugTools = process.env.INCLUDE_DEBUG_TOOLS === "true";
  const stripPrefix = !!(process.env.COWORK || process.env.CLAUDECODE);
  const appPrefix = `${meta.app}_`;

  /** Strip app prefix from tool name when in Cowork (MCP namespace provides context). */
  function externalName(name: string): string {
    return stripPrefix && name.startsWith(appPrefix) ? name.slice(appPrefix.length) : name;
  }

  /** Restore app prefix for dispatch to handleTool. */
  function internalName(name: string): string {
    return stripPrefix && !name.startsWith(appPrefix) && tools.some((t) => t.name === appPrefix + name)
      ? appPrefix + name
      : name;
  }

  function assembleTools(): ToolDef[] {
    const all: ToolDef[] = [...BUILTIN_TOOLS];
    if (includeDebugTools) all.push({ ...debugTool(meta.app), name: externalName(debugTool(meta.app).name) });
    for (const tool of tools) {
      const t = { ...tool, name: externalName(tool.name) };
      if (allowInlineLarge) {
        all.push({
          ...t,
          inputSchema: {
            ...t.inputSchema,
            properties: { ...t.inputSchema.properties, inline: output.INLINE_PARAM },
          },
        });
      } else {
        all.push(t);
      }
    }
    return all;
  }

  const SAFE_ENV_KEYS = [
    "NODE_ENV", "MCP_OUTPUT_DIR", "MCP_INLINE_THRESHOLD",
    "ALLOW_INLINE_LARGE", "INCLUDE_DEBUG_TOOLS", "CLAUDECODE", "COWORK",
    "PATH", "HOME", "SHELL",
  ];

  async function dispatch(exName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const name = internalName(exName);
    switch (name) {
      case "set_output_dir": {
        output.setOutputDir(args.path as string);
        return { content: [{ type: "text", text: `Output directory set to: ${output.getOutputDir()}` }] };
      }
      case `${meta.app}_debug_env`: {
        const safeEnv = Object.fromEntries(
          Object.keys(process.env)
            .filter((k) => SAFE_ENV_KEYS.includes(k) || k.startsWith("CLAUDE"))
            .map((k) => [k, process.env[k]]),
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              cwd: process.cwd(),
              node: process.version,
              platform: process.platform,
              output_dir: output.getOutputDir(),
              allow_inline_large: allowInlineLarge,
              env: safeEnv,
            }, null, 2),
          }],
        };
      }
      default:
        return await handleTool(name, args);
    }
  }

  const server = new Server(
    { name: meta.app, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: assembleTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<{ content: Array<{ type: "text"; text: string } | { type: "resource_link"; uri: string; name: string; mimeType: string }>; isError?: boolean }> => {
    const { name, arguments: args } = request.params;
    try {
      return await dispatch(name, args as Record<string, unknown>);
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${meta.app} v1.0.0 running`);
}
