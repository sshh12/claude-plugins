# Stage 10: Challenges & Feedback (Optional)

Generate a `CHALLENGES.md` report documenting everything that went wrong, was surprising, or required workarounds during the build. This creates a reusable record for the user and helps improve the diy-mcp-connector skill over time.

**When to offer:** After Stage 9 is complete, ask the user: *"Would you like me to generate a challenges report? It documents the issues we hit, how we solved them, and what generalizes to other apps."*

---

## Report Structure

Write `<app>/<APP>_DEVELOPER_FEEDBACK.md` with the following sections. Only include sections where something notable happened — skip sections where everything worked on the first try.

### Header

```markdown
# Challenges Building the <App Name> MCP Connector

Notes from building the <App Name> MCP server. These challenges generalize to
[brief characterization — e.g. "any app behind Cloudflare and SSO",
"GraphQL apps with query allowlisting", etc.].
```

### Per-challenge format

Each challenge should follow this structure:

```markdown
## N. <Short descriptive title>

**Problem:** What happened — the symptom as you first saw it.

**Root cause:** Why it happened — the underlying mechanism.

**Signals:** How to recognize this is happening (error messages, behavior patterns).

**Fix:** What we did to resolve it.

**Generalization:** Does this apply to other apps? Under what conditions?
```

---

## What to include

Review the full build session and capture challenges from every stage. Common categories:

**Auth & login issues**
- Auth pattern misclassification (cookie vs token, hybrid detection)
- Bot detection blocking automated Chrome (Cloudflare, Akamai, etc.)
- Chrome instance conflicts during auth testing
- Pre-auth cookie capture (analytics cookies before SSO completes)
- Token extraction timing (localStorage not populated yet)

**API discovery issues**
- Internal API vs developer API differences
- Undocumented endpoints, inconsistent response shapes
- GraphQL allowlisting discovered mid-build
- Pagination behavior different from expected

**Response format issues**
- Non-standard date/time formats (database-level representations)
- Unlabeled units (milliseconds, bytes, enum values)
- Mixed response types (JSON for some endpoints, HTML for others)
- Nested/SDUI responses requiring extraction

**Build issues**
- Stream consumption bugs (body read twice)
- stdout contamination breaking MCP protocol
- Missing dependencies or version incompatibilities
- CORS or domain validation issues

**Testing issues**
- Tool naming collisions
- Response size thresholds needed tuning
- Edge cases in empty/error responses

---

## What NOT to include

- Steps that worked as expected on the first try
- Generic setup instructions (those belong in the skill references)
- Sensitive information (tokens, passwords, internal URLs with auth params)
- Temporary debugging steps that were later removed

---

## After generating

1. Write the report to `<app>/<APP>_DEVELOPER_FEEDBACK.md`
2. Tell the user where the file is and offer a brief summary
3. Ask if they'd like to share any of the challenges as feedback to improve the diy-mcp-connector skill — e.g. *"Any of these issues feel like something the skill should handle better out of the box?"*
