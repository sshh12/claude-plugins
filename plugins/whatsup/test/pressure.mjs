// Parallel-interaction pressure harness for the whatsup in-process-owner model.
//
//   node test/pressure.mjs
//
// Every client is the same mcp-server.js. Exactly one wins an atomic
// Unix-socket listen() and becomes the OWNER (runs WhatsApp + serves IPC);
// the rest are PROXIES. `status` reports {role, ownerPid}. We drive many
// clients over MCP stdio against a throwaway sandbox (no real WhatsApp
// creds) and assert single-owner invariants, re-election on owner kill,
// stale-socket self-heal, and subscription routing across handoff.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
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
  console.error(`Build first: ${SERVER} missing (npm run build)`);
  process.exit(1);
}

const SANDBOX = mkdtempSync(join(tmpdir(), "whatsup-pressure-"));
const ENV = {
  ...process.env,
  WHATSUP_DAEMON_SOCKET_FILE: join(SANDBOX, "owner.sock"),
  WHATSUP_AUTH_DIR: join(SANDBOX, "auth"),
  WHATSUP_HISTORY_FILE: join(SANDBOX, "messages.jsonl"),
  WHATSUP_LOG_FILE: join(SANDBOX, "whatsup.log"),
  WHATSUP_AUDIT_LOG: join(SANDBOX, "audit.jsonl"),
  WHATSUP_QR_CODE_FILE: join(SANDBOX, "qr.png"),
  WHATSUP_READ_MODE: "all",
  WHATSUP_TEST_INJECT: "1",
};
const SOCK = ENV.WHATSUP_DAEMON_SOCKET_FILE;
const HISTORY = ENV.WHATSUP_HISTORY_FILE;

const allClients = new Set();
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

class Client {
  constructor(label) {
    this.label = label;
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
    this.channelMsgs = [];
    this.proc = spawn(process.execPath, [SERVER], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    this.pid = this.proc.pid;
    allClients.add(this);
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
      } else if (m.method === "notifications/claude/channel") {
        const ct = m.params?.meta?.chat_type;
        if (ct && ct !== "system") this.channelMsgs.push(m.params);
      }
    }
  }
  _send(o) {
    try {
      this.proc.stdin.write(JSON.stringify(o) + "\n");
    } catch {}
  }
  request(method, params, timeoutMs = 25000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.label} ${method} timeout`)), timeoutMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }
  async init() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pressure", version: "1.0" },
    });
    this._send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  async call(name, args = {}) {
    const r = await this.request("tools/call", { name, arguments: args });
    return JSON.parse(r.result.content[0].text);
  }
  kill() {
    try {
      this.proc.kill("SIGKILL");
    } catch {}
    allClients.delete(this);
  }
}

async function waitFor(fn, ms, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}

function historyParsable() {
  if (!existsSync(HISTORY)) return true;
  return readFileSync(HISTORY, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .every((l) => {
      try {
        JSON.parse(l);
        return true;
      } catch {
        return false;
      }
    });
}

// Collect {client, st} for every given client; find the one reporting owner.
async function statuses(clients) {
  const out = [];
  for (const c of clients) {
    try {
      out.push({ c, st: await c.call("status") });
    } catch (e) {
      out.push({ c, st: { ok: false, error: String(e) } });
    }
  }
  return out;
}
function owners(sts) {
  return sts.filter((x) => x.st && x.st.role === "owner");
}
function ownerPidsAgree(sts) {
  const pids = new Set(sts.filter((x) => x.st && x.st.ok).map((x) => x.st.ownerPid));
  return pids.size === 1 ? [...pids][0] : null;
}

async function main() {
  // ---- 1: 8 simultaneous clients → exactly one owner ----
  console.log("\n# 1 — 8 simultaneous clients → single owner");
  const eight = Array.from({ length: 8 }, (_, i) => new Client(`A${i}`));
  await Promise.all(eight.map((c) => c.init()));
  const s1 = await statuses(eight);
  check(s1.every((x) => x.st && typeof x.st.ok === "boolean"), "all 8 status well-formed");
  check(owners(s1).length === 1, `exactly one owner (got ${owners(s1).length})`);
  const op1 = ownerPidsAgree(s1);
  check(op1 != null, "all clients agree on a single ownerPid");
  check(
    owners(s1).length === 1 && owners(s1)[0].c.pid === op1,
    `owner client's pid (${owners(s1)[0]?.c.pid}) == reported ownerPid (${op1})`
  );
  check(existsSync(SOCK), "socket file present");

  // ---- 2: high concurrent tool load ----
  console.log("\n# 2 — concurrent tool load (8×25)");
  const ops = [];
  for (const c of eight)
    for (let k = 0; k < 25; k++) {
      const p = k % 4;
      ops.push(
        p === 0
          ? c.call("status")
          : p === 1
            ? c.call("read_chat", { chat_id: "15550000000@s.whatsapp.net" })
            : p === 2
              ? c.call("search", { query: "x" })
              : c.call("reply", { chat_id: "+15551112222", text: "hi" })
      );
    }
  const res = await Promise.allSettled(ops);
  check(res.every((r) => r.status === "fulfilled"), `all ${ops.length} calls returned`);
  const replies = res
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v) => v && v.ok === false && v.messageIds === undefined);
  check(
    replies.length > 0 && replies.every((v) => typeof v.code === "string"),
    "every gated reply rejected with a well-formed error code (no crash)"
  );
  const s2 = await statuses(eight);
  check(owners(s2).length === 1 && ownerPidsAgree(s2) === op1, "owner stable & single after load");

  // ---- 3: kill the owner process → re-election ----
  console.log("\n# 3 — SIGKILL the owner → re-election");
  const ownerClient = owners(s2)[0].c;
  ownerClient.kill();
  const survivors = eight.filter((c) => c !== ownerClient);
  const recovered = await waitFor(async () => {
    const s = await statuses(survivors);
    return owners(s).length === 1 && ownerPidsAgree(s) != null && ownerPidsAgree(s) !== op1;
  }, 20000);
  check(recovered, "survivors re-elected exactly one NEW owner");
  const s3 = await statuses(survivors);
  check(
    s3.every((x) => x.st && x.st.ok === true),
    "all survivor calls recover (ok) on the new owner"
  );
  check(historyParsable(), "messages.jsonl has zero unparseable lines");

  // ---- 7: subscription routing & sticky re-subscribe across handoff ----
  console.log("\n# 7 — subscription routing & handoff");
  const A = new Client("S-A"),
    B = new Client("S-B"),
    C = new Client("S-C");
  await Promise.all([A.init(), B.init(), C.init()]);
  await Promise.all([A.call("status"), B.call("status"), C.call("status")]);
  const mk = (n) => ({
    id: `inj-${n}-${Date.now()}`,
    chatId: "15559998888@s.whatsapp.net",
    sender: "15559998888@s.whatsapp.net",
    senderName: "Tester",
    pushName: "Tester",
    text: `inject ${n}`,
    timestamp: Math.floor(Date.now() / 1000),
    isFromMe: false,
    isGroup: false,
    hasMedia: false,
    messageType: "conversation",
  });
  const m1 = mk(1);
  await A.call("__test_inject", { msg: m1 });
  await sleep(400);
  check(
    A.channelMsgs.length === 0 && B.channelMsgs.length === 0 && C.channelMsgs.length === 0,
    "no client receives inbound before subscribing"
  );
  await A.call("subscribe");
  await B.call("subscribe");
  const m2 = mk(2);
  await A.call("__test_inject", { msg: m2 });
  check(
    await waitFor(
      () =>
        A.channelMsgs.some((p) => p.meta.message_id === m2.id) &&
        B.channelMsgs.some((p) => p.meta.message_id === m2.id),
      3000
    ),
    "subscribed A & B both receive inbound"
  );
  await sleep(200);
  check(!C.channelMsgs.some((p) => p.meta.message_id === m2.id), "unsubscribed C does not");
  await B.call("unsubscribe");
  const m3 = mk(3);
  await A.call("__test_inject", { msg: m3 });
  check(await waitFor(() => A.channelMsgs.some((p) => p.meta.message_id === m3.id), 3000), "A still receives after B unsubscribed");
  await sleep(200);
  check(!B.channelMsgs.some((p) => p.meta.message_id === m3.id), "unsubscribed B no longer receives");

  // Kill whichever of A/B/C is the owner → forces handoff; A's sticky
  // subscription must re-assert on the new owner.
  const abcSt = await statuses([A, B, C]);
  const abcOwner = owners(abcSt)[0]?.c;
  if (abcOwner) abcOwner.kill();
  await sleep(500);
  const live = [A, B, C].filter((c) => c !== abcOwner);
  const driver = live[0];
  const m4 = mk(4);
  const inj4 = await driver.call("__test_inject", { msg: m4 });
  check(inj4 && inj4.ok === true, "system healthy after owner handoff (inject ok)");
  if (A !== abcOwner) {
    check(
      await waitFor(() => A.channelMsgs.some((p) => p.meta.message_id === m4.id), 4000),
      "A's subscription re-asserted on the new owner (still receives)"
    );
  } else {
    check(true, "A was the owner that was killed (handoff exercised)");
  }

  // ---- 5: 2-client spawn race ----
  console.log("\n# 5 — 2-client spawn race");
  for (const c of [...allClients]) c.kill();
  await sleep(500);
  try {
    if (existsSync(SOCK)) rmSync(SOCK);
  } catch {}
  const r1 = new Client("R1"),
    r2 = new Client("R2");
  await Promise.all([r1.init(), r2.init()]);
  const sr = await statuses([r1, r2]);
  check(sr.every((x) => x.st && x.st.ok), "both racing clients get a valid status");
  check(owners(sr).length === 1 && ownerPidsAgree(sr) != null, "exactly one owner from the race");

  // ---- 6: stale socket file cleanup ----
  console.log("\n# 6 — stale socket file self-heal");
  r1.kill();
  r2.kill();
  await sleep(500);
  try {
    if (existsSync(SOCK)) rmSync(SOCK);
  } catch {}
  writeFileSync(SOCK, "junk-not-a-socket");
  const sc = new Client("STALE");
  await sc.init();
  const scs = await sc.call("status");
  check(scs && scs.ok === true && scs.role === "owner", "client self-heals stale socket & becomes owner");
  sc.kill();

  // ---- 4: rapid client churn ×20 ----
  console.log("\n# 4 — rapid client churn ×20");
  await sleep(400);
  let allSingleOwner = true;
  for (let i = 0; i < 20; i++) {
    const c = new Client(`CH${i}`);
    await c.init();
    const st = await c.call("status");
    if (!(st && st.ok && st.role === "owner")) allSingleOwner = false;
    c.kill();
    await sleep(60);
  }
  check(allSingleOwner, "every churned solo client became owner (stale socket always self-heals)");

  console.log(`\n# Result: ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => {
    console.error("\nHarness error:", e);
    fail++;
  })
  .finally(async () => {
    for (const c of [...allClients]) c.kill();
    try {
      rmSync(SANDBOX, { recursive: true, force: true });
    } catch {}
    process.exit(fail === 0 ? 0 : 1);
  });
