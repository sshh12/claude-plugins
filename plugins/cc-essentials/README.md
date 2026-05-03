# cc-essentials

A grab-bag of meta-skills that make working with Claude Code easier. Currently ships:

- **`build-skill`** — walks you through building a Claude Code skill end-to-end: framing the problem, mapping data sources, writing SKILL.md, testing, packaging, and installing.
- **`build-agent-team`** — designs a long-running, autonomous Claude Code agent team for the current project and writes a `/start-<team>-team` skill that spawns it. Covers philosophy, loop-based role design, mandatory leader and auditor roles, communication protocol, constraints, and subagent review passes that harden the team against reward-hacking.

## Install

```sh
/plugin marketplace add sshh12/claude-plugins
/plugin install cc-essentials@shrivu-plugins
```

## Use

Just ask. The right skill triggers automatically.

For `build-skill`:

- "Help me build a skill for weekly status reports."
- "I keep re-explaining how to triage these issues. Can you turn it into a skill?"
- "How do skills work in Claude Code?"

For `build-agent-team`:

- "I want to build an agent team for this project."
- "Set up a multi-agent system that runs my research and trading loops."
- "Help me design a crew of agents that can run autonomously for a few weeks."

`build-agent-team` requires Claude Code's experimental agent teams feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).
