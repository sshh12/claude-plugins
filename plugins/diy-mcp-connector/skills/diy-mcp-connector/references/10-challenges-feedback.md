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

## Classify Each Challenge

For each challenge, tag it with one of these categories. This determines whether the issue is actionable for improving the skill.

### Skill gaps (highest signal)
Issues where the skill's stages, templates, or docs didn't cover a real scenario. These improve the skill directly.

- **Missing auth classification** — the app's auth pattern wasn't recognized (e.g. API-key, OAuth device flow)
- **Stage didn't apply** — a required stage was inapplicable for this app type (e.g. HAR capture for a documented API)
- **Template mismatch** — a bundled template assumed behavior the app doesn't have
- **Gate too strict/loose** — a gate blocked progress unnecessarily, or let a broken state through
- **Missing pattern** — a known pattern (SDUI, allowlisting, CSRF) wasn't detected or documented

### Recurring gotchas (medium signal)
Issues that affect many apps and could be documented better.

- Auth: pre-auth cookie capture, bot detection, Chrome instance conflicts, SSO redirect domain changes
- API: pagination differences, mixed response types, internal vs public API divergence
- Build: stdout contamination, env var passing, stream consumption, date/timezone bugs
- Testing: response size tuning, empty/error edge cases

### App-specific quirks (low signal)
Issues unique to this app's API that don't generalize. Still worth documenting for the user's reference, but don't suggest skill changes for these.

- Vendor-specific API inconsistencies (e.g. different param shapes between endpoints)
- Undocumented API behavior specific to this service
- Workarounds for this app's particular data model

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
3. Highlight any challenges tagged as **skill gaps** — these are the ones worth feeding back
4. Ask: *"Any of the skill-gap issues feel like something worth fixing in the templates or docs? I can make the changes now."*
