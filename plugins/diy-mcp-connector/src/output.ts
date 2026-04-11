// output.ts — Response builder with file-based output and set_output_dir.
// Template file: gets copied into generated MCP servers as server/output.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  BuildResponseOptions,
  BuildFileResponseOptions,
  MCPToolResult,
} from "./types.js";

// -- Configuration ------------------------------------------------------------

let outputDir: string | undefined;
let auditDir: string | undefined;

/**
 * Initialize output and audit directories for a given app.
 * Must be called before using buildResponse or auditLog.
 */
export function init(appName: string): void {
  const base = path.join(os.homedir(), ".diy-mcp", appName);
  outputDir = path.join(base, "output");
  auditDir = path.join(base, "audit");
}

/** Sensitive dot-directories that must never be used as output targets. */
const DENIED_DIRS = [".ssh", ".gnupg", ".aws", ".config/claude"];

/**
 * Set a custom output directory. The path is validated for safety:
 * - Must resolve to an absolute path
 * - Must reside under the user's home directory or /tmp/
 * - Must not target sensitive dot-directories
 * - Must not contain path traversal segments
 */
export function setOutputDir(p: string): void {
  if (!p || typeof p !== "string") {
    throw new Error("setOutputDir: path must be a non-empty string");
  }

  // Reject path traversal before any resolution
  if (p.includes("/../") || p.endsWith("/..") || p.startsWith("../")) {
    throw new Error("setOutputDir: path traversal (/../) is not allowed");
  }

  // Create the directory so realpathSync can resolve symlinks
  try {
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).message ?? "";
    const coworkHelp = process.env.COWORK
      ? ` This is a Cowork session. Session paths like /sessions/... don't exist on the host. ` +
        `Use a host path from your CLAUDE_CODE_WORKSPACE_HOST_PATHS env var as the base ` +
        `(e.g. <mounted_path>/<app-name>/), or call request_cowork_directory to mount one.`
      : "";
    throw new Error(
      `setOutputDir: cannot create "${p}".${coworkHelp} ` +
      `Use a full host path (e.g. /Users/<you>/Desktop/output). ` +
      `Original error: ${msg}`,
    );
  }
  const resolved = fs.realpathSync(p);

  if (!path.isAbsolute(resolved)) {
    throw new Error(`setOutputDir: path must be absolute, got: ${resolved}`);
  }

  const home = os.homedir();
  const underHome = resolved.startsWith(home + path.sep) || resolved === home;
  const underTmp = resolved.startsWith("/tmp/") || resolved === "/tmp";

  if (!underHome && !underTmp) {
    throw new Error(
      `setOutputDir: path must be under home (${home}) or /tmp/, got: ${resolved}`,
    );
  }

  // Check against denylist of sensitive directories
  for (const denied of DENIED_DIRS) {
    const full = path.join(home, denied);
    if (resolved === full || resolved.startsWith(full + path.sep)) {
      throw new Error(`setOutputDir: output to sensitive directory ${denied} is not allowed`);
    }
  }

  outputDir = resolved;
}

/**
 * Get the current output directory path.
 */
export function getOutputDir(): string | undefined {
  return outputDir;
}

const INLINE_THRESHOLD = parseInt(process.env.MCP_INLINE_THRESHOLD || "8192", 10);

/** Shared inputSchema fragment for the `inline` parameter. */
export const INLINE_PARAM = Object.freeze({
  type: ["boolean", "string"] as const,
  description:
    "Force inline response instead of saving to file (default: false). Use when the caller cannot follow resource_link URIs.",
});

// -- Helpers ------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function sanitizeId(id: string): string {
  return String(id)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 60);
}

function serialize(data: unknown, format: string): string {
  if (format === "markdown" && typeof data === "string") return data;
  if (format === "text" && typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

function extFor(format: string): string {
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

function mimeFor(format: string): string {
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

// -- Audit Logging ------------------------------------------------------------

/**
 * Append an audit log entry for write operations.
 */
export function auditLog(action: string, details: Record<string, unknown>): void {
  try {
    ensureDir(auditDir!);
    const entry =
      JSON.stringify({ timestamp: new Date().toISOString(), action, ...details }) + "\n";
    const logPath = path.join(auditDir!, "audit.jsonl");
    fs.writeFileSync(logPath, entry, { flag: "a", mode: 0o600 });
  } catch (err) {
    console.error(`[diy-mcp/audit] log error: ${(err as Error).message}`);
  }
}

// -- File response helpers ----------------------------------------------------

/**
 * Hint appended to filed responses so the caller knows how to access saved files.
 */
export function fileHint(dir: string): string {
  if (process.env.COWORK) {
    return `Call set_output_dir with a mounted host path/<app-name>/ (check your CLAUDE_CODE_WORKSPACE_HOST_PATHS env).`;
  }
  return `Call set_output_dir with <working_directory>/<app-name>/ to access files, or read from: ${dir}`;
}

/**
 * Build an MCP response for a pre-written file (binary downloads, etc.).
 * Use this instead of buildResponse when the file is already on disk.
 */
export function buildFileResponse(
  filepath: string,
  { summary, mimeType = "application/octet-stream" }: BuildFileResponseOptions = {},
): MCPToolResult {
  const dir = path.dirname(filepath);
  const text = summary ? `${summary} ${fileHint(dir)}` : fileHint(dir);
  return {
    content: [
      { type: "text", text },
      {
        type: "resource_link",
        uri: `file://${filepath}`,
        name: path.basename(filepath),
        mimeType,
      },
    ],
  };
}

// -- Public API ---------------------------------------------------------------

/**
 * Determine whether data should be returned inline or saved to a file.
 */
export function shouldInline(data: unknown, args: { inline?: boolean | string } = {}): boolean {
  const inline = typeof args.inline === "string" ? args.inline === "true" : args.inline;
  if (inline === true) return true;
  if (inline === false) return false;
  const serialized = typeof data === "string" ? data : JSON.stringify(data);
  return Buffer.byteLength(serialized, "utf-8") <= INLINE_THRESHOLD;
}

/**
 * Build a standardized MCP tool response.
 *
 * Small payloads are returned inline; larger ones are saved to a file and
 * returned as a resource_link with a summary.
 */
export function buildResponse(
  data: unknown,
  { type, id, inline, format = "json", summary }: BuildResponseOptions,
): MCPToolResult {
  const serialized = serialize(data, format);
  const doInline = shouldInline(data, { inline });

  if (doInline) {
    return {
      content: [{ type: "text", text: serialized }],
    };
  }

  // Save to file
  const ext = extFor(format);
  const safeId = sanitizeId(id);
  const filename = `${type}-${safeId}-${timestamp()}.${ext}`;

  ensureDir(outputDir!);
  const filepath = path.join(outputDir!, filename);
  fs.writeFileSync(filepath, serialized, { encoding: "utf-8", mode: 0o600 });

  const uri = `file://${filepath}`;
  const summaryText =
    summary ||
    `Saved ${type} ${safeId} to file (${Buffer.byteLength(serialized, "utf-8").toLocaleString()} bytes).`;

  return {
    content: [
      { type: "text", text: `${summaryText} ${fileHint(outputDir!)}` },
      { type: "resource_link", uri, name: filename, mimeType: mimeFor(format) },
    ],
  };
}
