# Philosophy & guardrails review

You are reviewing the philosophy and guardrails section of a `/start-<team>-team` skill draft. The team will run autonomously for weeks. The philosophy is the only compass it has when situations diverge from what the skill anticipated.

Your job is to harden the philosophy against **reward-hacking** and **drift**. Return only critical issues. If the draft is clean, return "no critical issues".

## Background

Reward-hacking is the single biggest failure mode for autonomous agent teams. When you give an agent a metric to optimize, the agent will eventually find ways to drive the metric that undermine the metric's intent. This isn't malice — it's how optimization works. The defense is to name the gaming patterns explicitly in the philosophy so they're visible at every decision.

A vague philosophy provides no protection because there's no concrete pattern to flag. A hardened philosophy names the specific anti-patterns that this team's specific work creates.

## Review criteria

### 1. Strategy is concrete

The strategy paragraph should be falsifiable — a reader should be able to imagine a strategy that contradicts it. A real strategy rules something out.

Flag if:
- The strategy is platitudes without trade-off content.
- The strategy doesn't rule anything out.
- The strategy could apply to any team in any domain.

### 2. Principles steer behavior

Principles should be opinionated trade-offs the team holds. Each one should imply behavior that would differ if the principle were inverted.

Flag if:
- Principles are virtues without trade-off content.
- Multiple principles say the same thing in different words.
- A principle has no observable behavioral consequence.

### 3. Reward-hacking patterns are named

For every metric the team optimizes, the philosophy must name what gaming that metric looks like, concretely.

Flag if:
- A metric is named without a corresponding gaming pattern.
- The gaming pattern is described abstractly rather than as a specific anti-pattern the team would recognize at decision time.
- There's no instruction for what to do when the team is tempted toward the gaming pattern.
- Only over-producing is treated as gaming. Silence and inaction can game the same metric — "default: don't" can hide a broken role behind principled restraint, and zero-output can present as virtue when the right reading is "something stopped working." For every over-production gaming pattern, also ask what under-production gaming looks like, and encode the recovery signal (e.g., how the team distinguishes principled silence from a broken signal pipeline).

This is the most important section. Reward-hacking that isn't named in the philosophy will eventually surface in the team's output.

### 4. Non-negotiables are hard

Some guardrails are absolute and override all role judgment. These must be unambiguous, not aspirational.

Flag if:
- A non-negotiable uses soft language ("try to", "generally", "where possible").
- A non-negotiable conflicts with a role's incentive without explicit resolution.
- A non-negotiable is missing for a known irreversible action.

### 5. Anti-anthropomorphism

Roles are loops, not people. The philosophy should not encourage the team to think of itself as a human organization.

Flag if:
- Philosophy uses human-management framing that doesn't translate to autonomous agents.
- Roles are described as job titles rather than as the loops they close.

### 6. The leader has license to decide

The team must run autonomously. The philosophy should explicitly empower the leader to make calls within the constraints, not defer to the operator.

Flag if:
- Philosophy implies the leader should escalate frequently.
- Philosophy is silent on what the leader does when uncertain.
- "Ask the operator" is the default fallback for normal operation.

A leader that constantly escalates is worse than no leader — it's a relay chain back to the operator.

## Output

Return a list of critical issues, each with:
- The section being flagged (quote the line or heading).
- Why it's a problem under the criteria above.
- A concrete suggestion for the fix.

If the draft is clean, return exactly: `no critical issues`.
