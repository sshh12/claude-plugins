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

### 3. Time-based resource access is defined

This generalizes the "stability window" pattern. When a shared resource can't be accessed concurrently — a shared file system being modified, an external API with serialization requirements, infra in a transitional state, exclusive locks on real-world systems, a budget window where one role gets priority — the constraints must specify who gets access when, and how it's coordinated. Platform-change windows are one instance of this; treat it as the general case.

The constraints should specify, per shared resource that needs exclusive or prioritized access:

- Whether access is concurrent, exclusive, or prioritized (one role first, others after).
- Who grants access windows (default: leader).
- How requests and grants are recorded so other roles can see the current state.
- Emergency-fix carve-outs.

Flag if:
- A resource needing exclusive or prioritized access isn't named.
- "Be careful" or "take turns" is the protocol — that's not a protocol.
- Grant authority is unclear or distributed (multiple roles can grant the same window).
- Emergency carve-outs aren't addressed.
- Budget allocations that are time-window'd (e.g., "trader gets priority on tokens during market hours") aren't connected to this section.

### 4. Time and reality come from CLIs, not the agent

Agents cannot self-track time, market hours, file state, or external system state. The constraints should name authoritative sources for facts the team relies on.

Flag if:
- Time-critical operations don't reference an authoritative time source.
- Roles are expected to "remember" what time it is or what state things were in.
- External state checks aren't tied to specific commands or CLIs.

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

Two distinct axes. **Sensitive data** the team handles needs handling rules — what can land on disk, what stays in memory, what may appear in messages/logs/artifacts. **Sensitive operations** the team could perform need permission rules — some files shouldn't be read at all, some commands shouldn't be run, some external accesses shouldn't happen. Without explicit rules, sensitive data leaks and risky operations execute by default.

Flag if:
- Sensitive data classes the team handles aren't named.
- Sensitive operations aren't classified — read access on certain files, destructive commands, external accesses with broad scope.
- No rule for what can be written to disk vs. kept in memory only.
- No rule for what may appear in messages, status artifacts, or memory files.
- Code-writing teams don't name a security review bar before code lands.
- External system access lacks credential-handling and scope rules.

### 9. Constraints are visible to every role

Every role should reference the constraints in their init protocol or critical behaviors, not just the leader.

Flag if:
- The constraints section reads as if only the leader needs to know.
- Role text doesn't reference the constraints.
- A constraint that affects a specific role isn't surfaced in that role's section.

## Output

Return a list of critical issues, each with:
- The constraint or section being flagged (quote it).
- Why it's a problem under the criteria above.
- A concrete suggestion for the fix.

If the draft is clean, return exactly: `no critical issues`.
