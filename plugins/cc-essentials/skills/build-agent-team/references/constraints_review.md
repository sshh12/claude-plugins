# Constraints review

You are reviewing the constraints section of a `/start-<team>-team` skill draft. Constraints are the hard guardrails that override role-level judgment.

Your job is to verify the constraints are complete, unambiguous, and actually enforce the philosophy's non-negotiables. Return only critical issues. If the draft is clean, return "no critical issues".

## Review criteria

### 1. Resource ownership and mutation classification

Every shared resource the team touches should be classified by **ownership** — agent-managed (the team owns operations on it) or operator-managed (the team can read or propose, but the operator owns mutations). For agent-managed resources, classify each mutation class as permitted, requires-operator-approval, or forbidden. This is the foundation other constraints build on; without it, every individual mutation gets re-litigated.

Resources commonly worth classifying: git history, deployments and infra, secrets and credentials, external service accounts, customer-visible state, financial accounts, third-party APIs.

Default toward operator-managed for high-blast-radius resources unless the operator has explicitly opted in. Git is the canonical case — most teams keep commit/push/branch operator-managed and let agents make working-tree changes only, because git is the team's primary review and rollback lever. But this is a default to lean toward, not a hard rule. Some teams want agents committing on feature branches or running automated PR flows, and the constraints should reflect what the operator actually wants.

Flag if:
- A class of resource isn't classified.
- Classification is implicit or vague — soft language without naming what specific operations agents can perform.
- A role implicitly has authority over a resource that isn't authorized in this section.
- The team interacts with a high-blast-radius resource where operator-managed wasn't at least considered as the default.
- A class of mutation on an agent-managed resource isn't classified as permitted / approval / forbidden.
- The classification conflicts with a role's mandate.
- Destructive operations on agent-managed resources lack an emergency-only carve-out.
- File system writes outside the repo or `/tmp/` aren't forbidden — these trigger operator permission prompts that block autonomous operation indefinitely.

### 2. Budget allocations have caps, trackers, and throttles

A long-running team consumes bounded resources — not just LLM tokens. The team likely draws from several consumable budgets: tokens, financial spend (real money the team moves), paid API call quotas, third-party rate limits, compute time, anything else with a cap. Each one needs:

- **Cap** — how much, over what window.
- **Tracker** — who's measuring consumption and how. Typically aggregated by the leader from per-role estimates in messages.
- **Throttle** — what slows or pauses when approaching the cap (cheaper models, fewer iterations, paused non-essential roles, smaller batch sizes).

Flag if:
- A consumable resource the team uses isn't budgeted at all.
- The constraints cover only tokens when other consumables are clearly in play (e.g., real-money spend, paid API quotas, rate-limited external services).
- A cap is named but no tracking mechanism exists.
- No throttling rule — just stops at cap, losing in-flight work.
- Per-role messages don't include consumption estimates feeding the trackers (where applicable).
- The token budget reasons only about output. On long-running teams, cache-write and cache-read on the team's own context (skill, role briefs, memory, status) typically dominate spend over output — every cron fire that re-loads heavy context pays cache-write again. The constraint should account for per-tick context size and a memory/status file size ceiling, not only output.

### 3. Time-based resource access is defined

This generalizes the "stability window" pattern. When a shared resource can't be accessed concurrently — a shared file system being modified, an external API with serialization requirements, infra in a transitional state, exclusive locks on real-world systems, a budget window where one role gets priority — the constraints must specify who gets access when, and how it's coordinated. Platform-change windows are one instance of this; treat it as the general case.

The constraints should specify, per shared resource that needs exclusive or prioritized access:

- Whether access is concurrent, exclusive, or prioritized (one role first, others after).
- Who grants access windows (default: leader).
- How requests and grants are recorded so other roles can see the current state.
- Emergency-fix carve-outs.

Flag if:
- A resource needing exclusive or prioritized access isn't named.
- "Be careful" or "take turns" is the protocol — that's not a protocol. Synchronization requires a named holder, a recorded location for the lock state, and a stale-reclamation rule (how long before a stuck lock can be reclaimed, by whom). A lock without reclamation is a deadlock waiting to happen.
- Grant authority is unclear or distributed (multiple roles can grant the same window).
- Emergency carve-outs aren't addressed.
- Budget allocations that are time-window'd (e.g., "trader gets priority on tokens during market hours") aren't connected to this section.

### 4. Time, reality, and capability come from probes, not assumption

Agents cannot self-track time, market hours, file state, or external system state. The constraints should name authoritative sources for facts the team relies on — and the team's capability stack (harness flags, daemons, APIs, auth state) is itself a fact that needs verification, not assumption.

Flag if:
- Time-critical operations don't reference an authoritative time source.
- Roles are expected to "remember" what time it is or what state things were in.
- External state checks aren't tied to specific commands or CLIs.
- The constraint treats external state as instantaneous when it's actually staleness-bounded. Between cron fires, message buffers can clear, daemons can cycle, sessions can expire, file mtime can change. Long-running operations that act on a snapshot read minutes earlier need to either re-verify before acting or tag their output with the snapshot's age.
- The team depends on a harness flag (e.g., cron durability, max-turns ceiling, persistent identifiers), CLI behavior, or external service availability without a boot-time probe that prints VERIFY or engages a documented FALLBACK. Silent capability gaps surface days later as confused failures — a flag the harness quietly ignored, a daemon that died overnight, an API that started returning a new error shape.

### 5. Operator-only is narrow and explicit

The constraints should enumerate operator-only decisions. The list should be short — long lists indicate inadequate autonomy.

Flag if:
- Operator-only is broad — uses soft categories instead of named actions.
- Operator-only includes things the leader could decide within budget and philosophy.
- Operator-only is missing for genuinely irreversible actions.

### 6. The constraints actually enforce the philosophy's non-negotiables

Every non-negotiable from the philosophy section should have a corresponding constraint that operationalizes it. A non-negotiable without an enforcement mechanism is aspiration, not guardrail.

Flag if:
- A philosophy non-negotiable has no operational constraint.
- A constraint contradicts a non-negotiable.
- Constraints exist that don't trace back to a stated principle or non-negotiable — these often indicate scope creep or unstated assumptions.

### 7. Conflict resolution between constraints

When two constraints could conflict, the precedence should be clear.

Flag if:
- Two constraints could fire simultaneously with no precedence rule.
- "Use judgment" is the resolution — constraints exist precisely because judgment isn't trusted on this axis.

### 8. Privacy and security are addressed

Two axes plus surfaces. **Sensitive data** the team handles needs handling rules; **sensitive operations** the team could perform need permission rules; **surfaces** the data may cross need explicit per-class permission. Sensitive content quietly migrating between surfaces is the dominant leak shape — an excerpt that's fine in working context, copied into a team message or a status report, becomes a real exposure. Surfaces typically include: working context, internal team messages, scan reports, memory files, status artifacts, operator channels, logs. The form is the team's choice (paragraph, table, per-role rule) — the existence of explicit surface rules is not.

Flag if:
- Sensitive data classes the team handles aren't named.
- Sensitive operations aren't classified — read access on certain files, destructive commands, external accesses with broad scope.
- **The surfaces dimension is missing** — the constraints name what's sensitive but not *where each class may appear*. Default behavior in this gap is "sensitive data appears wherever the role finds it convenient."
- No rule for what can be written to disk vs. kept in memory only.
- Code-writing teams don't name a security review bar before code lands.
- External system access lacks credential-handling and scope rules.

### 9. Constraints are visible to every role

Every role should reference the constraints in their init protocol or critical behaviors, not just the leader.

Flag if:
- The constraints section reads as if only the leader needs to know.
- Role text doesn't reference the constraints.
- A constraint that affects a specific role isn't surfaced in that role's section.

### 10. Memory and shared artifacts have stated lifecycles and a curation owner

Long-running teams are dominated by per-tick context cost — the size of memory files, status artifacts, and role briefs that every role re-reads on every iteration. Without explicit design, these artifacts default to append-only ledgers because agents naturally write "what just happened" the way human ops logs do. A status file specced as "current state" routinely degenerates into a week-long activity log; a role memory file mixes durable rules, rolling calibration, and per-iteration scan history in one place with no signal for what to prune. Cost compounds: cache-write past the 5-min TTL × cron cadence × team size × number of readers.

The skill (in constraints, memory, or wherever fits the team) should make explicit:

- **Lifecycle of each section** in each persistent artifact — replaced per iteration, rolling over a window, or durable. The form is the team's choice; the existence of a stated lifecycle for each section is not.
- **Owner of curation** per artifact — typically the leader for shared artifacts, the role itself for its own memory. Curation is part of the role's loop, not a chore to defer.
- **Status vs log** — artifacts re-read by many roles every iteration hold state, not history. If history matters (lock or fire history for debugging), it goes in a separate role-owned log file.
- **Calibration sunset** — calibration entries that don't promote to constitution or playbook within a stated window get archived. Without this, "decide and document" loops grow indefinitely.

Flag if:

- Sections within memory or status artifacts don't declare their lifecycle, or the skill ships sections without saying which content is replaced vs. accumulated vs. durable.
- Multiple roles write to the same artifact without a single named owner. Multi-writer artifacts produce duplication and drift.
- No role is responsible for pruning a growing artifact. The leader's role doesn't include curation, and no platform/derivative loop owns it either.
- The status artifact mixes current state with historical logs (lock history, fire history, closed queue items kept as struck-through). Historical content drives the file size; every role pays for re-reading it every iteration.
- The team has any "decide and document" or calibration-log loop without a stated promotion-or-archive window.
- Templates seeded into the team don't communicate which sections are append-only vs. windowed vs. durable. Templates set the team's default behavior; ungoverned templates produce ungoverned files.

## Output

Return a list of critical issues, each with:
- The constraint or section being flagged (quote it).
- Why it's a problem under the criteria above.
- A concrete suggestion for the fix.

If the draft is clean, return exactly: `no critical issues`.
