// Recovery / re-pair / alert harness for whatsup.
//
//   node test/recovery.mjs
//
// Drives the real mcp-server.js over MCP stdio against a throwaway sandbox
// (no real WhatsApp creds) and asserts the post-mortem fixes:
//   - the new tool surface exists (pair_request/pair_status/restore_credentials/health/alert)
//   - status/health expose the recovery fields
//   - reconnect REFUSES the dangerous replaced-401 state (the deauth cascade)
//     and force=true bypasses it — without wiping the credential file
//   - restore_credentials self-heals from an auth.bak backup
//   - the out-of-band alert webhook actually delivers
//   - pair_request validation (locked number) works without touching WhatsApp
//
// Connection state is injected via the WHATSUP_TEST_INJECT-gated
// __test_set_status hook; credentials are faked at the filesystem level.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "dist",
  "mcp-server.js"
);
if (!existsSync(SERVER)) {
  console.error(`Build first: ${SERVER} missing (bash build.sh)`);
  process.exit(1);
}

const SANDBOX = mkdtempSync(join(tmpdir(), "whatsup-recovery-"));
const AUTH_DIR = join(SANDBOX, "auth");
const CREDS = join(AUTH_DIR, "creds.json");

let pass = 0,
  fail = 0;
const check = (cond, msg) => {
  if (cond) {
    pass++;
    console.log(`  PASS ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeCreds = () => {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(CREDS, JSON.stringify({ fake: true }));
};

// ---- capture out-of-band webhook deliveries ----
const alerts = [];
const hook = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      alerts.push(JSON.parse(body));
    } catch {
      /* ignore */
    }
    res.writeHead(200);
    res.end("ok");
  });
});

class Client {
  constructor(env) {
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
    this.proc = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (d) => this._onData(d));
    this.proc.stderr.on("data", () => {});
  }
  _onData(d) {
    this.buf += d.toString();
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
      }
    }
  }
  request(method, params, timeoutMs = 15000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method} timeout`)), timeoutMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async init() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "recovery", version: "1.0" },
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }
  async listTools() {
    const r = await this.request("tools/list", {});
    return r.result.tools;
  }
  async call(name, args = {}) {
    const r = await this.request("tools/call", { name, arguments: args });
    return JSON.parse(r.result.content[0].text);
  }
  kill() {
    try {
      this.proc.kill("SIGKILL");
    } catch {}
  }
}

async function main() {
  await new Promise((r) => hook.listen(0, "127.0.0.1", r));
  const port = hook.address().port;

  const ENV = {
    ...process.env,
    WHATSUP_DAEMON_SOCKET_FILE: join(SANDBOX, "owner.sock"),
    WHATSUP_AUTH_DIR: AUTH_DIR,
    WHATSUP_HISTORY_FILE: join(SANDBOX, "messages.jsonl"),
    WHATSUP_LOG_FILE: join(SANDBOX, "whatsup.log"),
    WHATSUP_AUDIT_LOG: join(SANDBOX, "audit.jsonl"),
    WHATSUP_QR_CODE_FILE: join(SANDBOX, "qr.png"),
    WHATSUP_READ_MODE: "all",
    WHATSUP_AUTO_RECONNECT: "false", // keep the manager quiet in the sandbox
    WHATSUP_TEST_INJECT: "1",
    WHATSUP_ALERT_WEBHOOK_URL: `http://127.0.0.1:${port}/hook`,
    WHATSUP_PAIR_PHONE: "18126930201",
  };

  const c = new Client(ENV);
  await c.init();
  await c.call("status"); // force owner election

  // ---- 1: new tool surface ----
  console.log("\n# 1 — tool surface");
  const tools = await c.listTools();
  const names = new Set(tools.map((t) => t.name));
  for (const n of ["pair_request", "pair_status", "restore_credentials", "health", "alert"]) {
    check(names.has(n), `tool "${n}" is advertised`);
  }
  const reconnectDef = tools.find((t) => t.name === "reconnect");
  check(!!reconnectDef?.inputSchema?.properties?.force, "reconnect advertises a force parameter");

  // ---- 2: status/health recovery fields ----
  console.log("\n# 2 — status & health fields");
  const st = await c.call("status");
  check(st.ok === true, "status ok");
  check("needsRepair" in st, "status exposes needsRepair");
  check(st.alertChannelConfigured === true, "status reports alert channel configured");
  check(st.autoRepairEnabled === false, "autoRepairEnabled false (autoRepair off)");
  const h = await c.call("health");
  check(h.ok === true && "overall" in h && "sendPath" in h, "health returns overall/sendPath");
  check(h.alertChannelConfigured === true, "health reports alert channel configured");

  // ---- 3: reconnect guard on replaced-401 ----
  console.log("\n# 3 — reconnect guard (deauth-cascade fix)");
  writeCreds();
  await c.call("__test_set_status", {
    status: {
      authenticated: true,
      connected: false,
      needsRepair: true,
      replacedByOtherInstance: true,
      replacedCode: 401,
      deauthRisk: "test-401-conflict",
    },
  });
  const refused = await c.call("reconnect");
  check(
    refused.ok === false && refused.code === "REPAIR_REQUIRED",
    `reconnect refuses replaced-401 (got code=${refused.code})`
  );
  check(existsSync(CREDS), "credential file NOT wiped by the refused reconnect");
  const h2 = await c.call("health");
  check(h2.authHealth === "needs_repair", `health authHealth=needs_repair (got ${h2.authHealth})`);
  check(h2.deauthRisk === "test-401-conflict", "health surfaces the deauthRisk");
  const forced = await c.call("reconnect", { force: true });
  check(forced.code !== "REPAIR_REQUIRED", "force=true bypasses the guard (not refused)");
  check(existsSync(CREDS), "credential file still present after forced reconnect initiated");

  // ---- 4: restore_credentials self-heal ----
  console.log("\n# 4 — restore_credentials self-heal");
  // Simulate a deauth backup: move creds aside into an auth.bak dir.
  try {
    rmSync(AUTH_DIR, { recursive: true, force: true });
  } catch {}
  const bak = `${AUTH_DIR}.bak.1700000000000`;
  mkdirSync(bak, { recursive: true });
  writeFileSync(join(bak, "creds.json"), JSON.stringify({ fake: true, restored: true }));
  check(!existsSync(CREDS), "no live creds before restore");
  const restored = await c.call("restore_credentials");
  check(restored.ok === true, `restore_credentials ok (got ${restored.error ?? "ok"})`);
  check(
    typeof restored.restoredFrom === "string" && restored.restoredFrom.includes(".bak."),
    "restore reports the backup it came from"
  );
  check(existsSync(CREDS), "creds.json restored into the live auth dir");
  check(
    !readdirSync(SANDBOX).some((n) => n === "auth.bak.1700000000000"),
    "backup dir consumed by the restore"
  );

  // ---- 5: out-of-band alert delivery ----
  console.log("\n# 5 — out-of-band alert webhook");
  const marker = `oob-${Date.now()}`;
  const bad = await c.call("alert", {});
  check(bad.ok === false && bad.code === "INVALID_ARGUMENT", "alert with no text rejected");
  const sent = await c.call("alert", { text: marker });
  check(sent.ok === true && sent.delivered === true, "alert reports delivered");
  const got = await (async () => {
    for (let i = 0; i < 20; i++) {
      if (alerts.some((a) => a.kind === "manual" && a.text === marker)) return true;
      await sleep(100);
    }
    return false;
  })();
  check(got, "webhook received the manual alert out-of-band");

  // ---- 6: pair_request number lock ----
  console.log("\n# 6 — pair_request locked to WHATSUP_PAIR_PHONE");
  const mismatch = await c.call("pair_request", { phone: "19998887777" });
  check(
    mismatch.ok === false && mismatch.code === "INVALID_ARGUMENT",
    "pair_request refuses a number other than WHATSUP_PAIR_PHONE"
  );

  c.kill();
  console.log(`\n# Result: ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => {
    console.error("\nHarness error:", e);
    fail++;
  })
  .finally(async () => {
    try {
      hook.close();
    } catch {}
    try {
      rmSync(SANDBOX, { recursive: true, force: true });
    } catch {}
    process.exit(fail === 0 ? 0 : 1);
  });
