# Stage 4: Security Review (Subagent)

Spawn an independent Opus subagent to review the tool design against the checklist below. An independent reviewer catches things the builder misses.

## Workflow

1. Write the tool design from Stage 3 to `<app>/security-review/tool-design.md` — include each tool's name, description, parameters, endpoints called, response data, and whether write tools were requested
2. Spawn the reviewer subagent:

```
Agent({
  description: "Security review of MCP tool design",
  model: "opus",
  prompt: `Security-review the MCP tool design at <APP_DIR>/security-review/tool-design.md against the checklist in ${SKILL_DIR}/references/4-security-review.md. Write findings to <APP_DIR>/security-review/findings.md with: status (PASS/FAIL/PASS_WITH_WARNINGS), per-tool checklist table, critical issues list, warnings list. Severity: CRITICAL (blocks build), WARNING (user decides), INFO (noted). Return a one-sentence summary.`
})
```

3. Read `<app>/security-review/findings.md` — if any CRITICAL findings, fix the design and re-run (max 3 rounds)
4. Present findings to user. If write tools were requested, also present the write tool risks below and get explicit confirmation.

## Default: Read-Only

All generated MCP servers default to read-only. Only build write tools if the user explicitly requests write capabilities. If writes are requested, present the full risk assessment below and get explicit confirmation.

## Security Checklist (6 Points)

### 1. Read-only enforcement
- The MCP server must be **read-only**. No tools that write, update, delete, or modify data in the target app.
- Verify every designed tool only reads data.
- If a workflow requires writes, see "Write tool risk assessment" below.

### 2. No data exfiltration
- No tools that copy data to public or external locations: public pastebins, GitHub gists, third-party services, non-company email addresses.
- Tool outputs go to local files only (`~/.diy-mcp/<app>/output/`).
- The `set_output_dir` tool allows changing the output path, but only to validated local directories (see built-in tool risks below).

### 3. Untrusted input / prompt injection
- Does the MCP process input from untrusted external sources?
- Risk: a third party could hide malicious instructions in external data the tool reads.
- Examples of untrusted sources: public web content, third-party documents, external user submissions, emails.
- If yes: ensure the tool treats external content as data, not instructions. Never pass raw external content into system prompts or tool descriptions.

### 4. Sensitive data
- Does the MCP access unanonymized PII or confidential data?
- **Not allowed:** Direct access to raw, unmasked customer data (names, emails, phone numbers from production tables).
- **OK with justification:** Operational data that may incidentally contain sensitive info (tickets, internal messages, logs).

### 5. External writes
- Can the MCP send data outside the user's local environment?
- Examples: posting to external services, sending API calls to third parties, emailing addresses.
- The MCP server should never transmit data to external destinations.

### 6. Irreversible actions
- Can the MCP perform high-impact or irreversible actions?
- Examples: executing production SQL writes, terminating services, sending mass emails, modifying permissions.
- If any tool could cause irreversible harm, remove it from the design.

**If any check fails, redesign the tool before proceeding to Stage 5.**

## Built-in Tool Risks

### set_output_dir validation

The `set_output_dir` tool accepts a user-provided path. The `output.js` template includes these safety checks:

- **Path must be absolute** — rejects relative paths
- **Symlink resolution** — resolves via `fs.realpathSync` before validation to prevent symlink-based bypasses
- **Allowed prefixes** — path must be under `os.homedir()` or `/tmp/`
- **Denylist** — rejects paths containing sensitive dot-directories:
  - `.ssh` — SSH keys and config
  - `.gnupg` — GPG keys
  - `.aws` — AWS credentials
  - `.config/claude` — Claude Code config and secrets
- **Path traversal** — rejects paths containing `../` after resolution

These checks prevent a prompt injection attack from redirecting output to sensitive directories.

## Write Tool Risk Assessment

Only present this if the user explicitly requests write capabilities. Stop and present these 5 risks before building:

1. **Prompt injection leading to unintended writes** — A malicious payload embedded in external content could trick the LLM into calling a write tool.
2. **Data exfiltration via writes** — Write tools can be exploited to copy internal data into an attacker-visible location.
3. **Accidental destructive actions** — The LLM may misinterpret intent and perform irreversible actions.
4. **Scope escalation** — Write tools inherit all of the user's SSO session permissions.
5. **Cascading effects** — Writes can trigger downstream automations (webhooks, workflows, email notifications, CI/CD pipelines).

### Requirements for write tools

If the user confirms after reviewing these risks, write tools must:
- Be **narrowly scoped** (e.g., "create ticket in project X" not "create ticket in any project")
- Require **confirmation parameters** (e.g., `confirm: true`) for destructive operations
- **Log all write operations** to `~/.diy-mcp/<app>/audit/` via `output.auditLog`
- Never be triggered by content from untrusted sources
- **Append a `(sent via mcp)` suffix** to all user-visible text content, programmatically in the handler (not via the LLM prompt). This makes it clear the content was agent-assisted.

## Gate Condition

**Subagent reports no CRITICAL issues (or user explicitly accepts risks). Findings shown to user. Do not build until confirmed.**
