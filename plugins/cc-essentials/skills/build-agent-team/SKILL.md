---
name: build-agent-team
description: Designs a long-running, autonomous Claude Code agent team for the current project, then writes a /start-<team>-team skill that spawns it. Use when the user asks to build an agent team, multi-agent system, agent crew, agent squad, agent fund, agent org, or wants multiple agents running together with shared tasks and inter-agent messaging — even when they don't use the words "agent team". Pairs with Claude Code's experimental agent teams (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1). Produces a skill, not the team itself; the produced skill spawns the team.
---

# build-agent-team

Designs a long-running agent team for the current project and writes a `/start-<team>-team` skill that boots it. The team runs autonomously for days or weeks, coordinating through a shared task list and direct messages.

A team is not a workflow — it is an organization that runs while you sleep. Every design decision in this skill is about making sure that organization stays pointed at the right thing without supervision.

Throughout this skill, "the operator" means the human admin running and supervising the team — the person who built and started it, the person it escalates to. This is distinct from any other humans the team may interact with as part of its work (customers, end users, external contacts), which we call out as such when relevant.

## What an agent team is (and isn't)

A team is several Claude Code instances coordinating around a shared goal. Each teammate owns a **closing loop** — a recurring cycle from problem to closed solution. Teammates message each other directly; the lead coordinates without relaying every message.

Different from subagents (one-shot, report back to caller) and skills (encode a workflow inside one session). A team encodes parallel loops with their own cadences, memory, and judgment, sharing context but not waiting on each other.

## Design teams around closing loops, not specialties

The biggest design mistake is anthropomorphizing a human org chart. Human orgs split by skill specialization; a single Claude instance is already broadly multi-domain, so splitting along functional lines mostly adds coordination overhead and handoff loss.

Instead, split by **closing loops** — verticals of work where one role takes a problem from input to closed solution. Loop shapes:

- **Metric loop**: a number the role drives.
- **Problem loop**: a system or domain the role monitors and fixes.
- **Leadership loop**: direction, budget, institutional memory, cross-loop arbitration.
- **Platform (derivative) loop**: improves the skills, prompts, context, tooling, or memory that other loops depend on. The output isn't a primary work product — it's the substrate that makes the primary loops better over time. Without one, executor quality is bounded by initial setup.

Two roles never get cut: a **leader** and at least one **auditor**. Everything else is loops, often including at least one platform loop.

State each loop as an **input → closed-output** relationship: what signal enters the role's domain, and what "handled" looks like for that signal. Don't state loops as step sequences — those are workflows, not loops. Workflows go in critical behaviors and can evolve; the loop description is the role's accountability, not its procedure. "Cold inbound contact → cleared inbox per playbook" is a loop. "Scan inbox → triage → draft → send" is a workflow.

## When NOT to build a team

- The work fits in one session — don't split unless loops genuinely run in parallel.
- One-shot task — that's a subagent or a skill.
- Loops block on each other constantly — that's a relay chain, not a team.
- Token budget can't sustain N parallel sessions for the planned duration.

If borderline, suggest starting with a skill or subagent and graduating to a team only when sequential execution becomes the bottleneck.

## The interview

Free-form and conversational. Do not use `AskUserQuestion` — the goal is to draw out judgment, not collect form fields. Gather all of the following before drafting.

**Ask progressively.** Don't dump every question at once. Ask 1–3 of the most load-bearing questions per round, listen to the answers, then follow up grounded in what you heard. One big batch yields shallower answers than three rounds of two or three — and the operator's first answers usually reframe the questions you'd ask next anyway. Lead with the questions whose answers most constrain the rest.

### 0. Init — read what's already here

Before asking anything:

- Read `CLAUDE.md` for project conventions.
- List skills in `.claude/skills/` and installed plugins — these become "key skills" for relevant roles.
- Look for existing memory and team-status patterns. Extend if found; otherwise plan to suggest `memory/<ROLE>.md` (uppercase) for per-role durable lessons, and a single team-status artifact the leader maintains for operator catch-up.
- Note CLIs, scripts, and `Makefile` targets the team will lean on.

Tell the user what you found before interviewing further. Don't make them describe their own repo.

### 1. Purpose and loops

Open with the problem, not roles:

- What's the team trying to accomplish over the next weeks/months?
- Which goals are recurring metrics vs. open-ended problem domains?
- What inputs does it consume, what outputs does it produce, where does it hand back to humans?

From the answers, **propose** a loop decomposition. State each loop as input → closed-output, not as a step sequence. Confirm with the operator before naming any role. If the operator volunteers role names first, gently redirect: "Before we name roles, what loops are we closing?" Anthropomorphic splits are the default human instinct and you have to push against it.

Then push for **platform/derivative loops the user may not have considered**. For each executor loop in the proposed decomposition, ask: *what's improving over time, and who owns that improvement?* Skills, prompts, memory files, shared codebases, context curation, tools — these go stale or stay flat without a dedicated owner. The pattern: a researcher who improves the executor's prompt; a librarian who curates context; a platform engineer who refactors shared tooling so other loops move faster. Without these roles, the team peaks at week one and degrades.

Add a platform loop when: (1) the team runs long enough that initial setup will go stale, (2) execution quality is sensitive to internal tooling and context the team controls, (3) signal from execution can feed improvements back, (4) there's actual surface area to improve — the existing skills, prompts, and context are not already mature and battle-tested. If the executor's setup is solid and the improvement surface is small, a platform loop just churns; skip it. Short-running teams and teams using externally-maintained tooling also don't need one. One level of derivative is usually enough; "the role that improves the role that improves X" is rarely worth the coordination cost.

Finally, settle the **task list mechanism** — how teammates claim, track, and release units of work. Pick a concrete file or convention (e.g., a shared `TASKS.md` with claim/release rules, or whatever the existing repo pattern suggests). Without a mechanism, every teammate invents one and they collide.

### 2. Philosophy and guardrails

This section is the team's compass for weeks of autonomous operation. Get it right.

- **Strategy** — one paragraph on what the team believes about winning in this domain.
- **Principles** — the opinionated trade-offs every role inherits. Each principle should imply behavior that would differ if it were inverted.
- **Reward-hacking traps** — for every metric the team optimizes, ask: *what does gaming this look like?* Encode the gaming pattern explicitly. Naming the anti-pattern is more protective than naming the metric.
- **Non-negotiables** — guardrails that override every role's judgment. Things the team must not do even when tempted.

### 3. Roles

For each loop, gather:

- **Loop**: one sentence as input → closed-output — what signal enters the role's domain, and what does "handled" look like? Not the steps in between; those are critical behaviors.
- **Decision principles** (3 bullets): how this role makes calls, what trade-offs it prioritizes, what it values over what. Keep these concise — they're the role's compass when the situation is novel.
- **Critical behaviors**: must-do operational rules — mandatory message triggers, pre-checks, artifacts to produce. Each behavior should prevent a specific failure mode. Every role must re-check the time CLI against its cadence between units of work — `CronCreate` fires only on idle, so a busy role drifts otherwise.
- **Cron cadence**: how often this role self-pings to re-check state. Err toward more frequent — agents can't track time on their own.
- **Effort and model**: max effort + Opus for judgment-heavy roles. Low effort + Sonnet/Haiku only when the role is provably mechanical. When uncertain, default to Opus + max — degrading is cheaper than a bad call by an underpowered role.
- **Key skills**: skills already in the repo or the user's setup this role uses heavily. List name + one-line on how it's used. If a needed skill doesn't exist, flag it for the user to consider building separately.
- **Color**: visual identity for the team config (blue/green/orange/purple/cyan/red/yellow).

After roles are sketched, ask explicitly: **where do these roles step on each other?** Look for shared writable state, mutually exclusive work, and racing on shared artifacts. For each overlap, decide upfront — tighter ownership, leader-granted stability windows, or a sequence lock — and bake it into the relevant roles' critical behaviors. Coordination designed upfront beats coordination invented mid-incident.

### 4. The leader (mandatory)

Every team has exactly one leader. Naming is cosmetic — the role is not optional. The leader holds direction, budget, cross-loop arbitration, and institutional memory. The leader is also the only role with authority to escalate to the operator, shut down or respawn teammates, and grant stability windows.

A team without a leader is a relay chain. A team with multiple leaders deadlocks. Insist on exactly one.

The leader should not also be primary executor of another loop — that dilutes both. The leadership loop is a full role.

### 5. The auditor (mandatory)

Every team gets at least one auditor. The auditor produces no primary work — they review.

The auditor catches reward-hacking and constraint drift, which the leader is structurally biased against catching (the leader's incentives align with the team shipping, not with stopping the team). Cadence is **fixed**, not ad-hoc — leaders rationalize away their own doubts and skip ad-hoc audits when uncomfortable.

Decide with the user:

- What is each auditor specifically watching for? Tie it to the gaming patterns identified in step 2.
- Cadence: how often does the leader summon the auditor, and what artifacts does the auditor receive?
- Effort: always max + Opus.

Multiple auditors are fine when failure modes are distinct. Don't merge audit duties into the leader.

### 6. Communication protocol

The #1 failure mode for agent teams is **insufficient communication**. This phrase is hardcoded into the generated skill. Then, with the user, draft the message-trigger table.

For each ordered pair of roles, ask:
- What events MUST trigger a message?
- What does the message contain? (Lead with the action or decision needed; context after.)
- What's the response timeline? What's "silent" mean for this pair?

Also gather general principles: how to message (concise, action-first, full paths to artifacts, never structured JSON unless using protocol responses), and when to over-communicate (when in doubt, send). Apply the same to **feedback signals** — when one role observes something another loop could improve from (audit findings, operator overrides, corner cases hit during execution), route it to that loop. Feedback that stays where it lands is feedback the system loses.

Then ask: **what state should live in shared artifacts instead of messages?** Heavy content (reports, plans, dashboards), long-lived state (current strategy, open task list), and cumulative knowledge (memory) belong in files at known paths, with lightweight "I updated `<path>`" notifications instead of full content in messages. Map out the artifact-and-notification pairs upfront — who writes, who reads, where the file lives, when notifications fire.

Then nail down **operator-facing comms**, which is its own protocol distinct from internal team comms (and distinct from any operational comms the team has with other humans like customers or end users):

- **Who talks to the operator?** Default: only the leader. Non-leader roles route everything operator-facing through the leader. Multiple roles pinging the operator directly creates noise and contradictory asks.
- **When?** Tie to the autonomy boundary in step 8: decisions outside the boundary, periodic status digests, critical incidents that need awareness even without a decision.
- **What channel?** Terminal chat is the default. If the team needs to reach the operator out-of-band, the skill must name a specific channel and the exact CLI/API call. Agents can't invent a channel that isn't already wired up.
- **What format?** Operator messages must be self-contained (the operator lacks team context), severity-tagged, and link to artifacts rather than embed them.

If no out-of-terminal channel is set up, say so explicitly in the skill: "Operator comms are terminal-only; the team waits for the operator's next session for non-urgent items."

### 7. Constraints

Hard guardrails that override role judgment:

- **Resource ownership**: classify each shared resource (git, deployments, secrets, external accounts, financial state, customer-visible state, third-party APIs) as agent-managed or operator-managed. For agent-managed resources, further classify mutations as permitted / operator-approval / forbidden. Default toward operator-managed for high-blast-radius resources unless the operator opts in — git is the most common case, where teams typically keep commit/push/branch operator-managed and let agents make working-tree changes only. Default, not hard rule.
- **File system writes**: keep writes inside the repo or `/tmp/`. Writes elsewhere (home directory, system paths, sibling repos) trigger operator permission prompts that block the team — long-running autonomous operation depends on every write landing in a pre-approved location.
- **Budget allocations**: for every consumable the team draws from — tokens, real-money spend, paid API quotas, third-party rate limits, compute — set a cap, a tracker, and a throttle. Don't reduce this to just tokens; long-running teams usually have several bounded resources.
- **Time-based access**: for resources that can't be accessed concurrently (shared file system regions, exclusive external state, infra in transitional states, prioritized budget windows), specify who grants access and how. Platform-change "stability windows" are one instance — treat the general pattern explicitly.
- **Time and reality checks**: name the authoritative CLIs for time and state — agents cannot self-track time or external state.
- **Privacy and security**: two axes. Classify sensitive **data** (secrets, PII, customer data, proprietary code, regulated content) and the handling rules — disk vs. memory, what may appear in messages/logs/artifacts. Classify sensitive **operations** the agent shouldn't necessarily perform — some files shouldn't be read at all, some commands shouldn't run, some external accesses shouldn't happen. For code-writing teams, name the security review bar.

### 8. Autonomy boundary

Ask explicitly: **is anything operator-only, or can the leader make every call within the constraints?**

The common failure mode: an agent stops mid-stride asking "I'm not sure, what do you think?" when the operator wanted full autonomy. If autonomy is the goal, the leader must be empowered to decide everything within the constraints. Carve operator-only narrowly:

- Budget escalations above the cap.
- Strategic pivots that change the team's purpose.
- Irreversible actions at meaningful scale.

Everything else: the leader decides. Encode this both in the leader's principles ("when in doubt, decide and document") and in the constraints table.

Also ask: **what does done look like?** Stop conditions go in the leader's critical behaviors so the team proposes shutdown when they're met, instead of running indefinitely.

### 9. Failure mode handling

Walk through with the user, but encode only **principles** in the generated skill, not specific thresholds or recipes:

- Silent teammate — leader detects, retries, then resets. Distinguish silent-because-busy from silent-because-crashed via a process-level liveness check, not just message-responsiveness.
- Output drift from philosophy — auditor catches, leader corrects.
- Stuck loop — detection and break-out responsibility.
- Context exhaustion — long-running teammates accumulate context until they degrade. Leader watches for symptoms (lost recent state, repeated questions) and force-rotates: teammate writes a handoff to its memory file, leader respawns from that file.
- Unclaimable task — reassignment path.
- Budget cap hit — what throttles, what continues.

Concrete thresholds belong to the user; the skill records the principle.

### 10. Memory

Durable team learning takes several forms — settle which fit this team:

- **Per-role memory files** (default). `memory/<ROLE>.md` (uppercase), one per role. Best when lessons are role-specific.
- **Cross-cutting memory** — organized by platform, domain, task type, or repo when lessons fall along those lines better than by role. Use the existing repo pattern if one exists.
- **Skills as memory** — when a role's primary work is running a specific skill, lessons accumulate via edits to that skill rather than a separate file. Platform/derivative loops typically work this way: their closing loop *is* improving the skills other roles use.
- **The team skill itself (the constitution)** — `/start-<team>-team` is the team's operating constitution. The leader owns mutations to it. The auditor and other roles can propose edits, but only the leader applies them. This is how the team evolves its own philosophy, roles, comms, or constraints when situations require it.

Every role re-reads its memory at the start of each loop iteration, not just on startup. Audit findings, operator overrides, and observed failures must produce memory or prompt updates — not just one-off fixes.

Also settle the **team-status artifact** — a single file the leader updates on each leadership-loop iteration so the operator (and any new or respawned teammate) can catch up at a glance. Extend the repo's existing dashboard pattern if one exists; otherwise suggest a top-level `team-status.md`.

### 11. Save location

Default: `<repo>/.claude/skills/start-<team>-team/SKILL.md` — project-local, committed alongside the working repo. Ask before saving elsewhere.

## Drafting the skill

After the interview, draft `/start-<team>-team`. Use `references/skill_template.md` as a section checklist. The generated skill must be self-contained — every teammate reads it as their full brief.

**Push heavy content into the generated skill's `references/` folder, not the main body.** Memory file templates (one per role), status artifact templates, role-specific reference docs, and any other boilerplate go in `<generated-skill>/references/` and are pointed to from the body by absolute path. The body holds operating logic and decision rules; references hold the format scaffolding teammates only need to read on first boot. Every teammate re-reads the body on each orientation — keeping it lean is what makes long-running teams affordable.

Required sections, in order:

1. **Philosophy** — strategy, principles, anti-reward-hacking guardrails.
2. **Team table** — role · model · color · effort · ownership · purpose · loop · cron · key skills.
3. **Init protocol** — what every teammate reads on startup (this skill, CLAUDE.md, latest artifact, their memory file).
4. **Roles** — for each: loop, 3 decision principles, critical behaviors, key skills used.
5. **Communication protocol** — hardcoded "#1 failure mode is insufficient communication" line, message-trigger table, how-to-message principles.
6. **Constraints** — table of hard guardrails (resource ownership, budget allocations, time-based access, autonomy, time-source, privacy/security).
7. **Failure mode handling** — high-level principles for silent / drifting / stuck teammates.
8. **Memory** — pointer to the repo's memory pattern; per-role file paths.

The skill, when invoked, should:

- Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set.
- Spawn each teammate with their full role brief (extracted from the skill body) **and the max-turns ceiling set as high as the harness allows**. Long-running teams hit turn limits silently otherwise — a teammate that's run for days can quietly stop accepting work because it crossed the default cap.
- Have the leader run the init protocol and orient the team with current state.
- Have each teammate (including the leader) call `CronCreate` to set up their self-heartbeat — `durable: true` so it survives restarts.

## Subagent review passes

After drafting, run review passes. **Spawn one subagent per reference file in parallel** (single message, multiple `Agent` tool calls) — the reviews are independent and there's no reason to serialize them. Each subagent gets the prompt:

> Read `<reference path>` and the draft skill at `<draft path>`. Apply the review criteria from the reference. Return only **critical issues** — gaps, contradictions, places where the team would fail under the failure modes named in the reference. Be specific and quote sections you're flagging. If the draft is clean, return "no critical issues".

Use `general-purpose` subagents with Opus.

| Reference | Reviews for |
|---|---|
| `references/philosophy_review.md` | Reward-hacking hardening: are gaming patterns named, are non-negotiables hard? |
| `references/roles_review.md` | Roles, loops, auditor presence, team size, anthropomorphic traps, autonomy clarity |
| `references/communication_review.md` | Clarity, edge cases, cadence vs operation, silent-teammate handling, "ask the operator" anti-pattern |
| `references/constraints_review.md` | Coverage of resource ownership, budget allocations, time-based access, operator-only, time source, privacy/security |

**Run each review until clean.** Multiple rounds are expected. Apply fixes, then re-spawn the failing reviews in parallel again. Don't move on while critical issues remain.

## Saving and invoking

When all reviews are clean:

1. Show the final skill to the operator for review (this is non-optional — it's their team).
2. Save to the chosen location.
3. Offer to invoke `/start-<team>-team` immediately.

After save, the user owns it — they'll iterate as the team runs.

## Tips

- **Push back on team size > 6.** Coordination overhead grows non-linearly. If the user wants 8 roles, ask which loops actually run in parallel — most can usually merge.
- **Don't let the user pre-name roles.** Get the loops first, then name. Pre-named roles drag in human-org-chart assumptions.
- **Treat the philosophy section as load-bearing.** It's the only thing the team has to fall back on when situations diverge from what the skill anticipated. A vague philosophy produces a team that stalls or drifts.
- **The auditor is not optional.** If the user resists, ask what catches reward-hacking. The honest answer is usually nothing, which is the whole point.
- **Crons are cheap.** Default to more frequent. An agent that gets pinged unnecessarily ignores the ping; an agent that doesn't get pinged forgets the world.
- **Cron lifecycle is the leader's job.** On role spec changes, `CronDelete` the old cron and `CronCreate` the new — stale crons fire stale prompts.
- **Sub-agents inside teammates: only leader and platform roles.** Executors work in-session — `Task` calls inside an executor loop double-bill and blur ownership.
