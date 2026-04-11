// src/output.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var outputDir;
var auditDir;
function init(appName) {
  const base = path.join(os.homedir(), ".diy-mcp", appName);
  outputDir = path.join(base, "output");
  auditDir = path.join(base, "audit");
}
var DENIED_DIRS = [".ssh", ".gnupg", ".aws", ".config/claude"];
function setOutputDir(p) {
  if (!p || typeof p !== "string") {
    throw new Error("setOutputDir: path must be a non-empty string");
  }
  if (p.includes("/../") || p.endsWith("/..") || p.startsWith("../")) {
    throw new Error("setOutputDir: path traversal (/../) is not allowed");
  }
  fs.mkdirSync(p, { recursive: true, mode: 448 });
  const resolved = fs.realpathSync(p);
  if (!path.isAbsolute(resolved)) {
    throw new Error(`setOutputDir: path must be absolute, got: ${resolved}`);
  }
  const home = os.homedir();
  const underHome = resolved.startsWith(home + path.sep) || resolved === home;
  const underTmp = resolved.startsWith("/tmp/") || resolved === "/tmp";
  if (!underHome && !underTmp) {
    throw new Error(
      `setOutputDir: path must be under home (${home}) or /tmp/, got: ${resolved}`
    );
  }
  for (const denied of DENIED_DIRS) {
    const full = path.join(home, denied);
    if (resolved === full || resolved.startsWith(full + path.sep)) {
      throw new Error(`setOutputDir: output to sensitive directory ${denied} is not allowed`);
    }
  }
  outputDir = resolved;
}
function getOutputDir() {
  return outputDir;
}
var INLINE_THRESHOLD = parseInt(process.env.MCP_INLINE_THRESHOLD || "8192", 10);
var INLINE_PARAM = Object.freeze({
  type: ["boolean", "string"],
  description: "Force inline response instead of saving to file (default: false). Use when the caller cannot follow resource_link URIs."
});
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 448 });
}
function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
}
function serialize(data, format) {
  if (format === "markdown" && typeof data === "string") return data;
  if (format === "text" && typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}
function extFor(format) {
  switch (format) {
    case "markdown":
      return "md";
    case "text":
      return "txt";
    case "csv":
      return "csv";
    default:
      return "json";
  }
}
function mimeFor(format) {
  switch (format) {
    case "markdown":
      return "text/markdown";
    case "csv":
      return "text/csv";
    case "text":
      return "text/plain";
    default:
      return "application/json";
  }
}
function auditLog(action, details) {
  try {
    ensureDir(auditDir);
    const entry = JSON.stringify({ timestamp: (/* @__PURE__ */ new Date()).toISOString(), action, ...details }) + "\n";
    const logPath = path.join(auditDir, "audit.jsonl");
    fs.writeFileSync(logPath, entry, { flag: "a", mode: 384 });
  } catch (err) {
    console.error(`[diy-mcp/audit] log error: ${err.message}`);
  }
}
function fileHint(dir) {
  return `To access saved files, call set_output_dir to point output to your working directory, or read files from: ${dir}`;
}
function buildFileResponse(filepath, { summary, mimeType = "application/octet-stream" } = {}) {
  const dir = path.dirname(filepath);
  const text = summary ? `${summary} ${fileHint(dir)}` : fileHint(dir);
  return {
    content: [
      { type: "text", text },
      {
        type: "resource_link",
        uri: `file://${filepath}`,
        name: path.basename(filepath),
        mimeType
      }
    ]
  };
}
function shouldInline(data, args = {}) {
  const inline = typeof args.inline === "string" ? args.inline === "true" : args.inline;
  if (inline === true) return true;
  if (inline === false) return false;
  const serialized = typeof data === "string" ? data : JSON.stringify(data);
  return Buffer.byteLength(serialized, "utf-8") <= INLINE_THRESHOLD;
}
function buildResponse(data, { type, id, inline, format = "json", summary }) {
  const serialized = serialize(data, format);
  const doInline = shouldInline(data, { inline });
  if (doInline) {
    return {
      content: [{ type: "text", text: serialized }]
    };
  }
  const ext = extFor(format);
  const safeId = sanitizeId(id);
  const filename = `${type}-${safeId}-${timestamp()}.${ext}`;
  ensureDir(outputDir);
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, serialized, { encoding: "utf-8", mode: 384 });
  const uri = `file://${filepath}`;
  const summaryText = summary || `Saved ${type} ${safeId} to file (${Buffer.byteLength(serialized, "utf-8").toLocaleString()} bytes).`;
  return {
    content: [
      { type: "text", text: `${summaryText} ${fileHint(outputDir)}` },
      { type: "resource_link", uri, name: filename, mimeType: mimeFor(format) }
    ]
  };
}
export {
  INLINE_PARAM,
  auditLog,
  buildFileResponse,
  buildResponse,
  fileHint,
  getOutputDir,
  init,
  setOutputDir,
  shouldInline
};
