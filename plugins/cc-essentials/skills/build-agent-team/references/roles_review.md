# Roles review

You are reviewing the team table and per-role sections of a `/start-<team>-team` skill draft. The team will run autonomously for weeks.

Your job is to verify that the roles make sense as a coherent organization that closes loops without anthropomorphic baggage. Return only critical issues. If the draft is clean, return "no critical issues".

## Review criteria

### 1. Every role closes a loop

Each role must own a recurring cycle from problem to closed solution. The loop is either:
- A **metric loop** — a number the role drives.
- A **problem loop** — a system or domain the role monitors and fixes.
- A **leadership loop** — direction, budget, institutional memory.
- An **audit loop** — checking that other roles stay aligned with philosophy and constraints.

Flag if:
- A role has no recurring cycle — it just executes tasks the leader hands it.
- A role's "loop" is a label without a clear input → close-the-loop output.
- Two roles claim the same loop.
- A loop is split across multiple roles unnecessarily (cross-domain judgment isn't actually too wide).

### 2. The team has a leader

Exactly one leader role exists. The leader holds direction, budget, cross-loop arbitration, and institutional memory. Naming is cosmetic — the role matters.

Flag if:
- No leader role exists.
- Multiple roles claim leader-like authority without clear precedence.
- The leader is also primary executor of a loop other than the leadership loop (this dilutes the role).

### 3. The team has at least one auditor

The auditor produces no primary work — they review for reward-hacking and constraint drift. Auditor cadence must be **fixed** (a regular schedule the leader runs), not ad-hoc summoning.

Flag if:
- No auditor role exists.
- The auditor's responsibility is folded into the leader (leaders are biased against auditing themselves).
- The auditor is summoned ad-hoc instead of on a fixed cadence.
- The auditor's review criteria are vague — they should tie back to the gaming patterns named in the philosophy.

Multiple auditors are fine when distinct failure modes warrant it. One auditor with a clear remit is better than several with overlapping ones.

### 4. No anthropomorphic role splits

Roles split by closing loops, not by human job specialization. Claude is multi-domain by default; human functional splits add coordination cost without payoff.

Flag if:
- Role names map directly to human job titles without loop content.
- Two roles split a single loop along skill-specialization lines.
- A role's loop description is "supports the [other role]" — that's a relay chain, not a loop.
- Two roles exist because of **capacity** (one human couldn't hold both) rather than **expertise** (genuinely different judgment domains). Capacity splits should collapse — one Claude can hold both.

### 5. Team size is sane

Most teams should be 3–6 roles. Coordination overhead grows non-linearly past that.

Flag if:
- Team has 7+ roles. Suggest which loops could merge.
- Team has 2 roles and isn't obviously a leader + executor pair (1 loop + audit).

### 6. Decision principles are decision principles

Each role has 3 bullets that say how the role makes calls under uncertainty. They should be opinionated trade-offs, not virtues.

Flag if:
- A bullet is a virtue without trade-off content.
- A bullet is a behavior (something the role does) instead of a principle (how the role decides). Behaviors belong in the critical-behaviors section.
- Bullets across roles are interchangeable — each role's principles should reflect its loop.

### 7. Critical behaviors prevent specific failures

Each critical behavior should map to a failure mode someone can articulate. The connection between behavior and prevented failure should be visible in the surrounding text.

Flag if:
- A critical behavior has no clear failure mode it prevents.
- Critical behaviors duplicate the message-trigger table without adding constraint.
- Critical behaviors are aspirational rather than mandatory.
- A role that touches sensitive data, performs sensitive operations (reads, executions, external accesses), writes code, or interacts with external systems has behaviors covering only operational correctness — not the privacy/security rules from constraints.

### 8. Cron cadence matches operation

Each role has a self-heartbeat cron. The cadence should match how often the role realistically needs to re-check state.

Flag if:
- A judgment-heavy role has a cron measured in minutes (over-pinging burns tokens without payoff).
- An execution-critical role has a cron longer than a day (work piles up unobserved).
- The auditor's cron is missing or longer than a full loop iteration.
- Cron cadences across roles imply coordination that the message protocol doesn't support.

### 9. Effort and model match judgment intensity

Max effort + Opus for judgment-heavy roles (leader, auditor, primary researcher/strategist). Low effort + Sonnet/Haiku only when the role is provably mechanical.

Flag if:
- A judgment-heavy role is on Sonnet or Haiku (under-powered, will produce confident bad calls).
- A purely mechanical role is on Opus + max effort (over-spend without quality benefit).
- The leader is on anything other than Opus + max — this is almost never the right call.

### 10. Key skills are real

Each role lists key skills it uses. The names should match skills that actually exist in the repo, in the user's plugin set, or are flagged as gaps to build.

Flag if:
- A skill name appears that wasn't surfaced during the interview's repo scan.
- A skill is named without a one-line how-it's-used description.
- A role has no key skills listed and is doing non-trivial work — it should have at least the workflows it leans on documented somewhere.

### 11. Implicit or missing platform loops

When a team runs over weeks, executor quality is bounded by the tooling, prompts, skills, memory, and shared context the executors rely on. A **platform (derivative) loop** is a role whose closing loop is "make another loop better" — improving prompts based on observed failures, curating memory files, refactoring shared tools, trimming context bloat, writing tips for primary loops. Without one, the team peaks at initial setup and degrades.

Look for missing platform loops:

- An executor uses a skill, prompt, or context file that no role maintains.
- Memory or context that primary loops read but nobody curates or prunes.
- A codebase or tool the team uses internally that no role improves.
- The team runs over weeks and no role's primary output is "improvements to other loops".
- The user hand-curates artifacts the team depends on (sign that the work should be a role, not the user's chore).

Flag if:

- The team is long-running (weeks+), execution quality depends on internal tooling, but only executor + leader + auditor are present.
- An executor's tools or context will obviously stale over time and no role owns refresh.
- A platform loop exists but its loop is unclear — it should have a target it's improving and a way to measure improvement.

Don't flag if:

- The team is short-running.
- Executor tools are externally maintained (the team uses standard CLIs and external services).
- The executor's skills, prompts, and context are already mature with little obvious improvement surface — a platform loop here just churns.
- Adding the platform loop would create more coordination overhead than it saves.

When proposing a platform loop the user didn't consider, name what specifically degrades without it. "Trader needs a researcher who keeps the trading prompt sharp as market regime shifts" lands; "you should add a researcher" doesn't.

### 12. Synchronization and ownership boundaries

When two roles can interfere with each other's work, the role design must say so explicitly and name the coordination mechanism. Without an explicit rule, both run in parallel and corrupt each other's state.

Look for:

- **Mutually exclusive work**: Role A's work invalidates Role B's in-progress work, or modifies state Role B is reading.
- **Shared writable state**: two roles can modify the same files, configs, branches, or external systems. Either lock, sequence, or carve ownership.
- **Race conditions**: multiple roles could claim the same task or write to the same artifact concurrently.

Flag if:

- Two roles' ownership columns overlap on writable state without a stated coordination rule.
- A role's work implicitly requires another to be idle, but no protocol enforces it (no stability windows, no leader-granted exclusive periods).
- The team modifies shared external systems without a sequencing plan.
- Coordination relies on roles "knowing" not to step on each other rather than on an explicit rule.

The fix is usually one of: tighter ownership (split the writable state so only one role owns each piece), leader-granted windows (role requests, leader grants/denies), or sequence locks recorded in a known location.

### 13. Autonomy boundary is in the role text

The leader's principles or critical behaviors should explicitly state when the leader decides vs. escalates. Default toward "leader decides within constraints; operator-only carved narrowly".

Flag if:
- Leader's role text suggests escalating to the operator is the default for uncertainty.
- No role text addresses what to do when uncertain.
- A non-leader role has authority to escalate to the operator directly without going through the leader.

## Output

Return a list of critical issues, each with:
- The role or section being flagged (quote it).
- Why it's a problem under the criteria above.
- A concrete suggestion for the fix.

If the draft is clean, return exactly: `no critical issues`.
