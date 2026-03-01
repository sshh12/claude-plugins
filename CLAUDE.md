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

## Usage

```sh
/plugin marketplace add sshh12/claude-plugins
/plugin install <plugin-name>@shrivu-plugins
```
