# Communication protocol review

You are reviewing the communication protocol of a `/start-<team>-team` skill draft. The team runs autonomously, with teammates messaging each other directly.

The #1 failure mode for agent teams is **insufficient communication**. Your job is to verify the protocol is dense enough to keep the team coordinated, clear enough that messages aren't ambiguous, and robust enough to handle teammates that go silent or drift. Return only critical issues. If the draft is clean, return "no critical issues".

## Review criteria

### 1. The "#1 failure" line is hardcoded

The phrase "the #1 failure mode for agent teams is insufficient communication" (or close paraphrase) should appear verbatim near the top of the comms section, with a directive to default to over-communicating.

Flag if:
- The phrase is missing or buried.
- The directive is softened ("communicate when useful" instead of "default to over-communicating; if unsure, send").

### 2. Mandatory message triggers cover the operational spine

For every recurring operation the team performs, there must be at least one mandatory message capturing it. At minimum:

- Before starting any non-trivial unit of work — coordinate, get approval if needed.
- After completing that unit — report what happened, what's next, current state.
- When discovering something that changes assumptions — propagate immediately, don't batch.
- When blocked or stuck for too long — ask, don't spin.
- On a regular cadence even if nothing happened — silence is worse than a heartbeat ping.

Flag if:
- A recurring operation has no message trigger associated.
- "After completion" messages are missing (work disappears into a black hole).
- Surprising-discovery propagation isn't called out.
- Cadence-pings are missing.

### 3. Each trigger has clear sender, recipient, and content

Every row of the message-trigger table should have: who sends, who receives, what event, what content. Content should be specific named fields, not generic categories.

Flag if:
- A trigger has ambiguous recipient — pick a name.
- Content is generic ("update", "summary") instead of named fields the recipient can act on.
- The recipient can't act on the message because it lacks the inputs they'd need.

### 4. How-to-message principles are explicit

The skill should state how messages are formatted: action/decision first, context after; concise; full file paths not "the latest report"; plain text not structured JSON unless using protocol responses.

Flag if:
- No formatting guidance is given.
- The guidance is vague ("be clear") without concrete rules.
- Examples of message formatting (if present) violate the rules they're meant to illustrate.

### 5. Cadence makes sense for the operation

Cron cadences plus message triggers should produce a coherent rhythm. Mismatched cadences create either information lag or spam.

Flag if:
- Two roles' cadences imply messages will land while the recipient is mid-task and likely missed (cron only fires on idle).
- A time-critical operation depends on a recipient that pings infrequently.
- The leader's cadence is slower than its fastest-moving teammate's, creating un-arbitrated parallelism.

### 6. Edge cases and ambiguity are addressed

What happens when:
- A message goes unanswered? (timeout, retry, escalation)
- Two roles produce conflicting recommendations? (leader arbitrates, criteria for arbitration)
- A teammate sends a message that doesn't fit the protocol? (handled, ignored, flagged)
- The message contains uncertainty the recipient also can't resolve?

Flag if:
- The protocol addresses only the happy path.
- "Conflict between teammates" has no resolution path.
- Timeouts on responses aren't defined even loosely.

### 7. Silent-teammate handling is principled

When a teammate stops messaging, the team must detect and recover. The skill should encode high-level principles, not specific thresholds (those belong to the user).

Flag if:
- No protocol exists for detecting silent teammates.
- The protocol is "the leader will notice" — that's not a protocol, the leader has its own work.
- There's no recovery mechanism (retry, restart-with-memory, escalate).
- The mechanism for restarting a teammate doesn't preserve their accumulated context (typically via memory file).

### 8. The "ask the operator" anti-pattern is closed off

A common failure: a teammate stops mid-stride to message "I'm not sure, what do you think?" upward, defeating autonomy. The protocol should explicitly forbid this for normal operation and enumerate when operator escalation is actually warranted.

Flag if:
- The leader (or any role) treats "escalate to operator" as a default for uncertainty.
- Operator escalation criteria aren't narrow and specific.
- A role can escalate directly to the operator without going through the leader (the leader should arbitrate, not be bypassed).

### 9. Operator-facing comms have their own protocol

Comms with the operator (the admin running the team) are distinct from internal team comms — and distinct from any operational comms the team has with other humans (customers, end users, external contacts) as part of its actual work.

Flag if:

- The skill is silent on **who** talks to the operator. Default should be leader-only; non-leader roles route through the leader. Multiple roles pinging the operator directly creates noise and contradictory asks.
- The skill is silent on **when** the leader contacts the operator. The triggers should map to the autonomy boundary (decisions outside the line) plus any cadence-based digests or incident notifications.
- The skill is silent on **what channel** is used. Terminal chat is the default; if the team needs to reach the operator out-of-band, the skill must name the channel **and** the exact CLI/API call. Agents can't invent the integration.
- A non-terminal channel is named but not wired up (no CLI, no env var, no test). The skill should require validation that the channel works before relying on it, or fall back to terminal-only with that stated explicitly.
- Operator-facing message format isn't specified. These messages need to be self-contained (the operator lacks the team's context), include severity (decision needed vs FYI), and link to artifacts rather than embed full content.
- Non-leader roles can escalate directly to the operator without going through the leader. The leader is the single point of operator contact even when the trigger originates elsewhere.
- Operator-facing comms are conflated with comms the team has with other humans during its operations. Each external-comms channel (customer support, user notifications) is its own protocol with its own who/when/channel/format — don't merge them with operator comms.

### 10. Coordination via shared artifacts, not heavy messages

Not all coordination should happen through `SendMessage`. Some state is better expressed as a durable artifact one role writes and others read on demand, with lightweight messages signaling "I updated X" rather than embedding the content in the message itself.

Patterns that belong in shared artifacts (not messages):

- Heavy content one role produces and another consumes.
- Long-lived state read by many.
- Cumulative knowledge (memory files — never broadcast).

Patterns that belong in messages:

- Decisions and approvals that need explicit ack.
- Time-sensitive events (errors, blockers, completions).
- Targeted requests and handoffs.
- Lightweight "I updated `<path>`" notifications pointing at shared artifacts.

Flag if:

- The message protocol embeds large content (full reports, full state snapshots) in message bodies. The recipient should be pointed at a path, not handed the content.
- A piece of state is sent via repeated messages over time instead of being stored once in a file and re-read.
- A role consumes another role's artifact without any notification trigger — that's a silent dependency where the consumer can read stale data forever.
- The protocol has no "I updated X" notification class for shared artifacts the team relies on.
- Memory files or other write-once-read-many state are broadcast in messages.

The right pattern: writer maintains the artifact at a known path, sends a short "updated `<path>` — <one-line what changed>" message to consumers when meaningful, and consumers re-read the file on receipt or before acting on the state. This keeps message bandwidth low, preserves history in the artifact, and avoids blowing up context windows.

### 11. Self-aware about own limits

The protocol should acknowledge that messages may be missed (cron fires only when the recipient is idle), that recipients may be working when a message arrives, and that delivery isn't synchronous.

Flag if:
- The protocol assumes synchronous delivery.
- Critical decisions depend on a single message being received and acted on within a tight window without a follow-up mechanism.

## Output

Return a list of critical issues, each with:
- The trigger or section being flagged (quote it).
- Why it's a problem under the criteria above.
- A concrete suggestion for the fix.

If the draft is clean, return exactly: `no critical issues`.
