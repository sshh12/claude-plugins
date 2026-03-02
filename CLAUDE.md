# claude-plugins

Claude Code plugin marketplace by shrivu.

## Repo Structure

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json        # Marketplace catalog (lists all plugins)
├── plugins/
│   └── <plugin-name>/
│       ├── .claude-plugin/
│       │   └── plugin.json     # Plugin manifest (name, version, description)
│       ├── skills/
│       │   └── <skill-name>/
│       │       └── SKILL.md    # Skill definition
│       ├── agents/             # Agent definitions (.md files)
│       ├── hooks/              # Hook scripts
│       └── ...
├── CLAUDE.md
└── README.md
```

## Adding a Plugin

1. Create a new directory under `plugins/` with your plugin name (kebab-case).
2. Add a `.claude-plugin/plugin.json` manifest inside it.
3. Add skills, agents, hooks, MCP servers, or LSP servers as needed.
4. Register the plugin in `.claude-plugin/marketplace.json` under the `plugins` array.

## Docs

- Plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Creating plugins: https://code.claude.com/docs/en/plugins
- Plugin reference: https://code.claude.com/docs/en/plugins-reference
- Discover plugins: https://code.claude.com/docs/en/discover-plugins

### Skills Authoring Reference

When building skills for plugins, refer to these guides:

- **Skills Overview**: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
  - Skills are modular, filesystem-based capabilities with progressive disclosure (metadata -> SKILL.md -> bundled files)
  - SKILL.md requires YAML frontmatter with `name` (lowercase/hyphens, max 64 chars) and `description` (max 1024 chars, no reserved words like "anthropic"/"claude")
  - Three loading levels: metadata (always loaded, ~100 tokens), instructions (on trigger, <5k tokens), resources (as needed, unlimited)
  - Skills can bundle scripts, templates, and reference files alongside SKILL.md

- **Skills Best Practices**: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
  - Be concise — only add context Claude doesn't already have; keep SKILL.md body under 500 lines
  - Write descriptions in third person that include both what the skill does and when to use it
  - Use progressive disclosure: SKILL.md as overview, separate files for details (one level deep, no nested refs)
  - Match freedom level to task fragility: high freedom for flexible tasks, low freedom for fragile/exact operations
  - Use gerund naming (e.g. `processing-pdfs`) or action-oriented names; avoid vague names like `helper`/`utils`
  - Include feedback loops (run validator -> fix -> repeat) and checklists for complex workflows
  - For executable scripts: handle errors explicitly, document constants, prefer execution over loading into context

## Development Workflow

We are responsible for end-to-end testing everything we build. After making changes to a plugin, always build and run verification tests yourself rather than asking the user to test. This includes: `tsc --noEmit`, `bash build.sh`, and functional smoke tests against a running instance.

## Usage

```sh
/plugin marketplace add sshh12/claude-plugins
/plugin install <plugin-name>@shrivu-plugins
```
