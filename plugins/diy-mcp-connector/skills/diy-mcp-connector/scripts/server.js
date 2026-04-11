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
    description: "Change the directory where large responses are saved as files. Call this at the start of a session to point output to your working directory. Returns the resolved path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the desired output directory" }
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
  function assembleTools() {
    const all = [...BUILTIN_TOOLS];
    if (includeDebugTools) all.push(debugTool(meta.app));
    for (const tool of tools) {
      if (allowInlineLarge) {
        all.push({
          ...tool,
          inputSchema: {
            ...tool.inputSchema,
            properties: { ...tool.inputSchema.properties, inline: output.INLINE_PARAM }
          }
        });
      } else {
        all.push(tool);
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
    "PATH",
    "HOME",
    "SHELL"
  ];
  async function dispatch(name, args) {
    switch (name) {
      case "set_output_dir": {
        output.setOutputDir(args.path);
        const tip = process.env.COWORK ? " Tip: in Cowork, use request_cowork_directory to mount this path so saved files are readable." : "";
        return { content: [{ type: "text", text: `Output directory set to: ${output.getOutputDir()}${tip}` }] };
      }
      case `${meta.app}_debug_env`: {
        const safeEnv = Object.fromEntries(
          SAFE_ENV_KEYS.filter((k) => k in process.env).map((k) => [k, process.env[k]])
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
