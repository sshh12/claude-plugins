// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
var BUILTIN_TOOLS = [
  {
    name: "set_output_dir",
    description: "Change the directory where large responses are saved as files. Call at session start. Use <working_directory>/<app-name>/ (e.g. /Users/me/project/spinach/) not the bare working directory \u2014 avoid cluttering the user's project root. If the project already has an output/ or data/ convention, follow that instead. In Cowork: check CLAUDE_CODE_WORKSPACE_HOST_PATHS env var for mounted host paths. Returns the resolved path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to output directory (e.g. /Users/me/project/<app-name>/)" }
      },
      required: ["path"]
    }
  }
];
function debugTool(appName) {
  return {
    name: `${appName}_debug_env`,
    description: "Dump server environment: Node.js version, working directory, output dir, inline config. Use to diagnose connection or path issues.",
    inputSchema: { type: "object", properties: {} }
  };
}
async function startServer({ meta, tools, handleTool, output }) {
  const allowInlineLarge = process.env.ALLOW_INLINE_LARGE === "true";
  const includeDebugTools = process.env.INCLUDE_DEBUG_TOOLS === "true";
  const stripPrefix = !!(process.env.COWORK || process.env.CLAUDECODE);
  const appPrefix = `${meta.app}_`;
  function externalName(name) {
    return stripPrefix && name.startsWith(appPrefix) ? name.slice(appPrefix.length) : name;
  }
  function internalName(name) {
    return stripPrefix && !name.startsWith(appPrefix) && tools.some((t) => t.name === appPrefix + name) ? appPrefix + name : name;
  }
  function assembleTools() {
    const all = [...BUILTIN_TOOLS];
    if (includeDebugTools) all.push({ ...debugTool(meta.app), name: externalName(debugTool(meta.app).name) });
    for (const tool of tools) {
      const t = { ...tool, name: externalName(tool.name) };
      if (allowInlineLarge) {
        all.push({
          ...t,
          inputSchema: {
            ...t.inputSchema,
            properties: { ...t.inputSchema.properties, inline: output.INLINE_PARAM }
          }
        });
      } else {
        all.push(t);
      }
    }
    return all;
  }
  const SAFE_ENV_KEYS = [
    "NODE_ENV",
    "MCP_OUTPUT_DIR",
    "MCP_INLINE_THRESHOLD",
    "ALLOW_INLINE_LARGE",
    "INCLUDE_DEBUG_TOOLS",
    "CLAUDECODE",
    "COWORK",
    "PATH",
    "HOME",
    "SHELL"
  ];
  async function dispatch(exName, args) {
    const name = internalName(exName);
    switch (name) {
      case "set_output_dir": {
        output.setOutputDir(args.path);
        return { content: [{ type: "text", text: `Output directory set to: ${output.getOutputDir()}` }] };
      }
      case `${meta.app}_debug_env`: {
        const safeEnv = Object.fromEntries(
          Object.keys(process.env).filter((k) => SAFE_ENV_KEYS.includes(k) || k.startsWith("CLAUDE")).map((k) => [k, process.env[k]])
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
              env: safeEnv
            }, null, 2)
          }]
        };
      }
      default:
        return await handleTool(name, args);
    }
  }
  const server = new Server(
    { name: meta.app, version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: assembleTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await dispatch(name, args);
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }],
        isError: true
      };
    }
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${meta.app} v1.0.0 running`);
}
export {
  startServer
};
