# Skill template — `/start-<team>-team`

This is a section checklist for the generated skill, not a rigid form. Adapt freely. Every section listed here must appear in some form unless you have a specific reason to drop it (and the user agrees).

The generated skill is the team's full brief — every teammate reads it on startup. It must be self-contained.

```markdown
---
name: start-<team>-team
description: Spawns the <team> agent team — a coordinated, long-running multi-agent organization that <one-line purpose>. Use when the user asks to start, launch, boot, or run the <team> team. Requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1.
---

# start-<team>-team

<One paragraph: what this team does, how long it runs, what loops it closes.>

## Philosophy

<Strategy paragraph — opinionated, falsifiable, names what the team rules out.>

**Principles**
- <Principle 1 — opinionated trade-off, not a virtue>
- <Principle 2>
- <Principle 3>

**Reward-hacking traps**

For each metric the team optimizes:
- Metric: <metric>. Gaming pattern: <specific anti-pattern>. Defense: <how the team avoids it>.

**Non-negotiables**
- <Hard guardrail with no escape clause>
- <...>

## Team

| Role | Model | Color | Effort | Ownership | Purpose | Loop | Cron | Key skills |
|------|-------|-------|--------|-----------|---------|------|------|------------|
| <Leader> | opus | blue | max | <files/state> | Direction, budget, arbitration | Leadership loop | every 2h | <skill: how used> |
| <Executor 1> | opus | green | max | <files/state> | <metric or domain> | <closing-loop description> | every 1h while active | <skill: how used> |
| <Auditor> | opus | red | max | — | Reviews work for reward-hacking and constraint drift | Audit loop | weekly + on-demand | — |
| <...> | | | | | | | | |

## Orientation protocol

Re-run on initial spawn, respawn after rotation, or detected state divergence — not once. Every teammate, before any other work:

1. Read `<this skill path>` (re-read on each orientation).
2. Read `CLAUDE.md` for project conventions.
3. Read `<team-status path>` for current team state.
4. Read your role's full brief at `<this-skill-folder>/references/role_<your-role>.md`.
5. Read your role's memory file at `<memory/ROLE.md>`.
6. Set up your self-heartbeat cron via `CronCreate` with `durable: true` and the cadence in the team table. The prompt should re-trigger your role's loop check.

The leader, additionally:
- Run `<orient command>` to gather current state.
- Send the team an initial state snapshot via `SendMessage`.
- On any role spec change, `CronDelete` the role's old cron and `CronCreate` the new one — stale crons fire stale prompts.

## Roles

This section is the team's shared understanding of who does what. Each role's full brief — decision principles, critical behaviors, autonomy carve-outs, role-specific responsibilities — lives at `references/role_<name>.md` in this skill's folder. The role itself re-reads its full brief on each orientation. Other roles only need these summaries to know who to message and what to expect.

### <Leader>
- **Owns**: <files/state>
- **Loop**: <input → closed-output>
- **Cadence**: <cron>
- **Key skills**: <skill: how used>
- **Full brief**: `references/role_leader.md`

### <Executor 1>
- **Owns**: <files/state>
- **Loop**: <input → closed-output>
- **Cadence**: <cron>
- **Key skills**: <skill: how used>
- **Full brief**: `references/role_executor1.md`

### <Auditor>
- **Owns**: <files/state>
- **Loop**: <input → closed-output, review-shaped>
- **Cadence**: <cron>
- **Watches for**: <gaming patterns linked to the philosophy's reward-hack section>
- **Full brief**: `references/role_auditor.md`

Each `references/role_<name>.md` file contains, at minimum: the loop in full, decision principles (3), critical behaviors, key skills with usage notes, and autonomy carve-outs. The leader's brief additionally contains stop conditions, status artifact responsibilities, and constitution-edit authority. The auditor's brief additionally contains the explicit watch-list tied to the philosophy's named gaming patterns.

## Communication protocol

**The #1 failure mode for agent teams is insufficient communication.** Default to over-communicating. If you're unsure whether to send a message, send it.

### When to message (mandatory)

| Sender | Recipient | Trigger | What to include |
|--------|-----------|---------|-----------------|
| <Executor> | Leader | Before starting <unit of work> | Plan, basis, current state, est. token spend |
| <Executor> | Leader | After completing <unit of work> | What happened, current state, next, est. token spend |
| Any | Leader | Discovered something that changes assumptions | The finding, what it changes, recommendation |
| Any | Whoever can help | Blocked > <window> | What you're blocked on, what you've tried |
| Leader | Auditor | On audit cadence | Artifacts to review, what to look for |
| Auditor | Leader | Audit complete | Findings, severity, recommended action |
| Leader | Operator | Decision exceeds autonomy boundary | Decision, options, recommendation, why operator-needed |
| Any | Leader | Disagreement with a directive | The disagreement, reasoning, what would change your mind. (This is the team's primary drift signal — do not skip.) |

### When to message (encouraged)

- When you discover something surprising — propagate immediately.
- When you finish a task and are about to go idle — say what's next.

### How to message

- Use `SendMessage` with the teammate's name. Plain text, never structured JSON (except protocol responses).
- Lead with the action or decision needed; context after.
- Reference artifacts by full path, not "the latest report".
- Be concise but complete — the recipient should be able to act without follow-up clarification.

### Operator-facing comms

The "operator" is the human admin running and supervising this team. Distinct from any other humans the team interacts with during normal operations.

- **Who**: only the leader contacts the operator. Non-leader roles route through the leader.
- **When**: decisions outside the autonomy boundary, scheduled digests at `<cadence>`, critical incidents requiring awareness.
- **Channel**: `<terminal chat | named CLI/API e.g. "Slack via curl POST to $SLACK_WEBHOOK_URL" | etc.>`. If no out-of-terminal channel is wired up, the team waits for the operator's next session for non-urgent items.
- **Format**: self-contained (the operator lacks team context), severity-tagged (`[DECISION NEEDED]`, `[FYI]`, `[INCIDENT]`), linking to artifacts by full path rather than embedding content.

## Constraints

| Constraint | Rule | Enforcement |
|------------|------|-------------|
| Resource ownership | <Resource>: agent-managed / operator-managed. For agent-managed: <permitted operations>, <approval-required operations>, <forbidden operations>. | Every role checks before acting; leader enforces. |
| Budget allocations | <Consumable>: cap <X> per <window>. Tracker: <who/how>. Throttle: <what stops or slows>. | Leader aggregates per-role consumption estimates; throttles approaching cap. |
| Time-based access | <Resource>: concurrent / exclusive / prioritized. Grant authority: leader. | Roles request; leader grants and records. |
| Time / reality | Use `<CLI>` for time and `<CLI>` for state. Never trust agent's sense of time. | Every role on every time- or state-dependent action. |
| Operator-only | <narrow enumerated list> | Only the leader escalates; non-leaders message the leader. |
| Privacy and security | Data: <classes> with handling rules for disk/memory/messages/logs. Operations: <forbidden reads/commands/accesses>. Code review bar: <bar>. | Every role enforces; auditor reviews. |

## Failure mode handling

These are principles, not recipes. The leader applies judgment within them.

- **Silent teammate**: if a teammate doesn't respond within a reasonable window, the leader pings. Distinguish silent-because-busy from silent-because-crashed via a process-level liveness check, not just message-responsiveness. After a few attempts, the leader shuts down and respawns the teammate from its memory file.
- **Drifting teammate**: if a teammate's output drifts from the philosophy (caught by the auditor or noticed by the leader), the leader sends concrete corrective feedback referencing the philosophy section. If drift continues across rounds, the leader resets the teammate.
- **Stuck teammate**: if a teammate is spinning, the leader breaks the loop with a directive — what to try next, what to abandon, what to escalate.
- **Context exhaustion**: long-running teammates accumulate context until they degrade. Leader watches for symptoms (lost recent state, repeated questions) and force-rotates: teammate writes a handoff to its memory file, leader respawns from that file.
- **Unclaimable task**: if a task can't be completed by its claimer, it goes back to the task list with a note; leader reassigns.
- **Budget at cap**: throttle the most expensive consumers of the resource hitting cap first; preserve audit cadence; pause non-critical loops; escalate to the operator for cap increase only if explicitly listed in operator-only. Each budget (tokens, $$, API quotas, etc.) has its own throttle policy — don't generalize across consumables.

## Memory

Durable team learning lives in several places:

- **Per-role memory files** at `<memory/ROLE.md>` — role-specific lessons. Templates live at `references/memory_<role>.md` in this skill's folder; each role seeds its memory file from the template on first boot.
- **Skills the role runs** — for roles whose primary work is running a specific skill, lessons accumulate as direct edits to the skill, not a separate file. Platform/derivative roles work this way by default.
- **The team skill (this file)** — `/start-<team>-team` is the team's constitution. Only the leader applies edits; the auditor and other roles propose changes by messaging the leader.

Common rules:

- Every role re-reads its memory at the start of each loop iteration, not just on spawn.
- The leader may read all memory files.
- Each role updates its own memory when learning something that would change a future decision.
- Memory entries are short, principled, and standalone — readable months later without conversation context.

## Spawning

When this skill is invoked:

1. Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in the environment.
2. The leader (this session) reads the entire skill, then runs the init protocol.
3. The leader spawns each teammate via the agent-teams mechanism, passing the body section pointer plus the spawn-time instruction to read `references/role_<their-role>.md` as their full brief during orientation. **Set max turns as high as the harness allows on every spawn** — long-running teammates will silently hit turn caps otherwise.
4. Each teammate runs its own init protocol on startup, including setting up its `CronCreate` heartbeat.
5. The leader sends an initial state snapshot to the team.
6. The team begins operation.
```

## Notes for the build skill

- Replace every `<placeholder>` with content gathered in the interview.
- Drop sections only with explicit user agreement and a stated reason.
- Keep the body under ~600 lines — split rarely-needed detail into the team's memory or a separate reference file in the skill folder if needed.
- Test the description by writing 3 prompts that should trigger the skill (`/start-<team>-team`, "boot the <team>", "launch the <team> team") and confirming they all match.
