---
name: build-skill
description: Walks the user through building a Claude Code skill from problem statement to packaged skill folder. Use when the user asks to create a skill, build a skill, design a skill, write a SKILL.md, package a skill, or asks how to make a skill or how skills work, even if they don't use the exact word "skill". Covers naming, frontmatter, structure, testing, and installation.
---

# build-skill

Helps the user build a Claude Code skill end-to-end. A skill is a Markdown file with YAML frontmatter that Claude loads when its trigger description matches the user's intent — it encodes a workflow Claude should follow consistently.

## What makes a good skill

- Does one thing well — overly broad skills fail more often than overly narrow ones
- Specific enough to be useful, flexible enough to handle real variation
- Connects to data sources and tools available in the user's environment
- Solves a problem the user has actually felt, not a hypothetical
- Worth running at least weekly — one-off jobs don't justify the authoring cost

## The central risk: overfitting

You and the user will iterate on a small handful of test cases because it's fast — they know those cases in and out, and the feedback loop tightens. But the skill will get used hundreds or thousands of times across prompts neither of you have seen. A skill that works only for the test cases is useless. Resist piling on rigid rules to make the current example perfect at the cost of generality. Most edits should make the skill more robust, not more specific. When you're tempted to add a fiddly rule that fixes one case, ask whether it would still help — or hurt — on cases you haven't seen.

## Build process

Walk through these stages in order. Skipping the problem-mapping or testing stages is the most common cause of bad skills.

### 1. Start with the problem, not the solution

What's the painful workflow? What takes too long? What does the user keep re-explaining? Don't open with "I want a skill that..." — open with "Every week I have to..." Surface the real pain before designing anything.

**Mine the conversation first.** If the user just said "turn this into a skill" or "let's make this reusable", the workflow they want is probably already in the chat. Extract it: the tools used, the sequence of steps, the corrections they made along the way, the input and output formats observed. Confirm the extracted workflow with the user before interviewing further. Don't make them re-explain what they just did.

### 2. Map the steps and data

Walk the workflow as the user does it today. For each step, capture: what tool or data source they touch, what decisions they make, what the output is.

**Gather real examples.** If the skill produces something the user already makes by hand, ask for one or two best-quality samples. These serve two purposes:

1. **Learning material** — analyze structure, tone, and judgment patterns to extract criteria the user wouldn't articulate verbally.
2. **Test baseline** — compare the skill's output against these later. If the skill's result isn't clearly better than the baseline, the skill isn't done.

Skip this for net-new output formats or pure data-fetching skills.

**Map data inputs to access methods.** For each input the skill needs, decide how it gets the data:

- **Built-in tools** — `Read`, `Write`, `Edit`, `Bash`, `WebFetch`, `WebSearch`, `Agent` (subagents), `NotebookEdit`
- **MCP servers** — check what's available in this environment via `claude mcp list`. MCP tools surface as `mcp__<server>__<tool>`. Common examples: GitHub, filesystem, web browsers, databases.
- **CLIs the user already has** — `gh`, `jq`, `git`, language toolchains. These are often the cleanest way to reach external systems.
- **User-provided data** — file paths, pasted content, screenshots, or interactive answers via `AskUserQuestion`.

Claude Code can't reach external systems without an MCP server or a CLI it can shell out to. If data lives in an unconnected system, the skill must tell the user exactly what to provide and how — not "give me the data" but "export the report from <app> as CSV and pass me the path".

**Validate access before building.** Don't just check tool lists — run a real query against each data source the skill depends on. Permission filtering, rate limits, and stale credentials are gotchas that only surface at runtime. Discover them before the skill is built, not after.

**Externalize data that goes stale silently.** Current targets, headcount, contacts in roles that turn over, dashboards that get renamed — pull from a tool at runtime or store in a config the skill reads. Stable identity (the user's own name, their personal links, domains they own) and durable lessons from past experience are not volatile data; hardcoding is fine, and for personal context skills it's often the whole point. Test: if this fact silently went stale tomorrow, would the skill produce subtly wrong output? If yes, externalize. If no, hardcode.

**Name exact tools, not vague references.** Write "use `Read` to load the file" or "run `gh pr list --state open` via `Bash`", not "search for X" or "use the search tool". Ambiguous references push the model to pick the wrong tool or invent one.

**Define sparse-data fallbacks.** Validating access confirms the source works, but at runtime queries can return thin or empty results. For each data source, decide what the skill does when results are sparse: try an alternative source, ask the user, or surface a clear "missing data" message. Don't let the skill silently produce bad output from insufficient input.

### 3. Separate the user's judgment from the automatable parts

The user's judgment, taste, and context are inputs to the skill — not things to generate. The repetitive assembly, formatting, and structuring is what the skill encodes.

If the skill involves judgment calls (reviews, evaluations, recommendations, prioritization), the user's criteria are the most important input. Don't generate them — extract them. Start with the artifacts gathered in step 2: analyze what the user actually did, not just what they say they do. People are usually better at producing good work than describing why it's good.

Walk through their example with them: "I notice you structured this section a certain way — was that deliberate?" surfaces criteria they wouldn't have volunteered. Supplement with direct questions: What do they look for? What patterns do they flag? What separates a good output from a bad one?

### 3b. Decide where the human enters at runtime

Some judgment can be fully encoded in the skill — that's what step 3 captures. But many skills still need the human at runtime: the input has ambiguity the skill can't resolve, the user has context the skill can't predict, or the output requires their taste. Decide upfront *how* the skill pulls them in. Three patterns work; pick one — or sometimes none — based on where the uncertainty lives. Be intentional and explicit about this in the SKILL.md; an unplanned mix of modalities is the most common cause of awkward interaction.

**Generate options, let them pick.** When the user may not know exactly what they want but can recognize the right answer when they see it, produce multiple candidates and have them choose. Works for things like tone (formal vs casual), layout, summary length, color choices, headline phrasing. The skill does the generating; the human does the recognizing. Use `AskUserQuestion` for short picks; for richer alternatives, render them in whatever modality fits — side-by-side markdown, file diffs, multiple chart drafts.

**Interview them.** When you need the *principles* behind the task — the criteria and priorities the user has in their head but hasn't articulated — interview via free-response. Don't use `AskUserQuestion` here; the goal isn't a concrete pick, it's drawing out judgment. Take a couple of rounds. Ask follow-ups that surface inconsistencies ("you said X earlier but this case suggests Y — which matters more?"). Confirm your synthesis before producing output.

**Plan before executing.** When the skill has all the information it needs but the *shape* of the output benefits from review, propose a plan before producing the full thing. For code, that's a design doc — schemas, key APIs, high-level architecture. For a blog post, that's an outline. For a scheduled automation, the list of steps and the key decisions at each. The plan is structural enough to be reviewable but light enough that a redirect doesn't waste much work. Approve, then build.

**Sometimes none of the above.** Skills that consistently produce the right output the first time shouldn't pause for input — that's friction without payoff. If the user has nothing useful to add at runtime, just produce the result.

The right pattern depends on where the uncertainty lives. Several plausible outputs and the user picks one → generate options. The criteria themselves are unclear → interview. The output's structure needs sign-off → plan first. None of those → no human input needed. Skills that try to do all three at once are exhausting to use.

### 4. Write the SKILL.md

A skill is plain text. Describe the steps as if explaining to a competent colleague who's never done this task. The key principle: **explain the why, not just the what.** Reasoning lets the model generalize and handle edge cases. Rigid rules without reasons break in cases the rule didn't anticipate.

**Yellow flag: ALL-CAPS rules.** "ALWAYS do X" or "NEVER do Y" usually means the rule is too rigid. Reframe as reasoning. "NEVER use tables" becomes "Avoid tables — readers view this output on mobile where wide tables wrap and become unreadable." When the reason is on the page, the model can judge edge cases instead of mechanically following.

Body content to include:

- The steps in order
- What "good" looks like and why
- Common gotchas and why they're gotchas
- Where the data lives
- What the output should look like

### 5. Decide the output format

Don't assume. Ask the user. Concrete options:

- **File written to a path** — script, document, code, generated artifact
- **Markdown printed in the response** — for one-shot summaries and reports
- **A git commit or PR** — opened via `gh pr create` for code-shaped output
- **A scheduled task** — see step 5b
- **An interactive HTML file** — for dashboards or anything with live filtering/sorting
- **Stdout the user pipes elsewhere** — when the audience is technical and wants raw text

If the skill can't deliver to where the output needs to go, say so explicitly in the instructions and define the best alternative ("I can't post directly to Slack — I'll write the message to a file you can paste").

### 5b. Consider scheduling

If the skill should run on a recurring basis (daily briefings, weekly recaps, monitoring checks), pair it with the `/schedule` skill to set up a cron-driven background agent. The schedule's prompt invokes the skill.

For event-based triggers that aren't time-based ("when a new ticket lands"), use a frequent cadence and have the skill check whether the condition has been met since the last run. This turns a polling schedule into a pseudo-event trigger.

### 6. Human review of the skill itself

Before testing, show the user the full SKILL.md. Ask them explicitly to read it and flag anything wrong, missing, or off. **This is not optional.** They're the expert on the workflow, the skill is encoding their judgment, and they need to confirm the encoding is right — not just review the output later.

### 7. Test on real tasks

Run the skill on actual work, not hypotheticals. **Run at least 2-3 real examples** before reporting success. Show the full output for each so the user can evaluate quality across variation, not a single cherry-picked case.

**Decide whether formal test cases are worth setting up.** Skills with objectively verifiable output (file transforms, data extraction, fixed workflow steps, code generation against a spec) benefit from a small saved test suite — you can run cases, check assertions, and catch regressions cheaply. Skills with subjective output (writing style, design taste, judgment-heavy ranking) often don't — human review is the only real bar, and assertions force-fit onto subjective qualities are noise. Match the testing investment to the skill type.

**Real prompts have texture.** Don't test with `"Format this data"`. Test with how a user would actually write it — file paths, casual speech, partial info, typos, backstory. Compare:

- Bad test prompt: `"Add a profit margin column to this spreadsheet."`
- Good test prompt: `"ok so my boss just sent me this xlsx (its in downloads, called something like 'Q4_sales final FINAL v2.xlsx') — she wants a profit margin column, revenue is in C and costs are in D i think."`

A skill that handles the polished version but breaks on the messy real one isn't done.

**Compare against the baseline.** Pull up the examples gathered in step 2. Is the skill's result actually better than the manual version? More consistent? Faster? If not, the skill isn't done.

**Read the process, not just the result.** Look at the intermediate steps and tool calls the skill produced. Sometimes the final output looks fine but the skill wasted effort getting there — unnecessary detours, throwaway helpers, or steps that didn't contribute. That's a signal to trim instructions that caused the wasted work.

### 8. Iterate

When something goes wrong, don't bail and do it manually — fix the instructions. Every correction makes the skill better next time. Doing it by hand is low leverage; fixing the skill is high leverage.

**When stuck on a stubborn issue, try a different framing instead of more rigid rules.** If the skill keeps making the same mistake despite explanations and added constraints, piling on more MUSTs and NEVERs usually doesn't help — and often degrades behavior on cases that were already working. Try reframing the task entirely: a different metaphor, a different pattern of working, a different way of carving up the steps. It's cheap to try, and sometimes a totally different framing lands where rule-tightening can't.

## Skill file structure

Skills live at `.claude/skills/<skill-name>/` inside the project repo. They're committed alongside the code and active for anyone working in the repo with Claude Code.

```
.claude/skills/<skill-name>/
├── SKILL.md           # The skill (required)
├── references/        # Detailed docs loaded only when needed
└── scripts/           # Executable code the skill calls
```

Scripts should write runtime data (collected JSON, intermediate results, generated files) to the working directory or a temp dir — not into the skill folder itself. Skills are versioned content; mixing run output into the skill folder makes diffs noisy and blurs the line between skill definition and skill output. Pass file paths as arguments to scripts; resolve writable locations at runtime.

## SKILL.md format

```markdown
---
name: skill-name
description: What this skill does and when to use it. Include phrases users would actually type.
---

# Skill Name

[Steps, quality bar, gotchas]
```

**Naming rules:**

- Folder name and `name` field: lowercase with hyphens only — `weekly-recap`, not `WeeklyRecap` or `weekly_recap`
- Folder name must match the `name` field exactly
- Max 64 characters
- No spaces

### The description field

The description is the most important part of the skill — it's how Claude decides whether to load the skill. If it doesn't match what the user said, the skill won't trigger no matter how good the body is. Max 1024 characters.

**Skills under-trigger more often than they over-trigger.** Claude tends to skip a skill that would have helped, more than it pulls in a skill that doesn't fit. The cure is a slightly aggressive description that claims adjacent territory:

- Bad: `"Generates dashboards for internal metrics."`
- Better: `"Generates dashboards for internal metrics. Use when the user mentions dashboards, data visualization, KPI tracking, or wants to display company data, even if they don't explicitly use the word 'dashboard'."`

The "even if they don't explicitly use..." pattern is the useful trick — it gives Claude permission to trigger on adjacent phrasings instead of demanding an exact keyword match. Apply it whenever the skill should fire on a *concept*, not a *word*.

The description must include both **what** the skill does and **when** to use it. List phrases users would actually type.

**Test triggering with near-misses.** Write 3-4 prompts that should trigger the skill and 3-4 that share keywords but should not. The most useful negative tests are near-misses — prompts that share concepts with the skill but actually need something different. "Write a fibonacci function" as a negative for a reporting skill is too easy. "Summarize what my team did this week from git log" as a negative for a Jira-based status skill is much more useful. Refine the description until both sets behave correctly.

**Simple prompts may not trigger skills at all.** Claude handles straightforward one-step tasks directly without consulting skills. If your skill only triggers on substantive multi-step requests, that's normal — target the description at the workflows the skill is meant for, not simple queries Claude already handles.

### Body guidelines

- Imperative form ("Search for X") not directives to the model ("You should search for X")
- Keep under 500 lines — split detail into reference files only if length truly demands it
- Don't repeat trigger phrases from the description in the body — the description handles triggering, the body handles execution
- Examples and instructions must agree. If a rule says "skip empty rows" but a template includes an empty-row example, the model follows the example. Examples are more concrete than rules, so they win. Audit templates against the rules they're supposed to illustrate.

## Tips

Cross-cutting principles that apply across stages.

- **Don't state the obvious.** Claude already has broad knowledge — only encode what steers it away from defaults. If you can state the principle and let the model extrapolate the procedure, do that. A skill that loses half its content when you cut step-by-step instructions in favor of principles was too verbose to begin with.

- **Build a gotchas section.** Every time the skill does something wrong in testing, add a line. Don't try to anticipate gotchas during the first draft — wait for them to surface. This becomes the most valuable part of the skill over time.

- **Start small, iterate often.** Most good skills started as a few lines and grew. Don't try to make the first draft perfect.

- **Prune what isn't working.** After testing, actively remove instructions that aren't pulling their weight. If the model is wasting time on unproductive steps, cut the instructions that caused them. A shorter skill that produces the same quality output is always better.

- **Spot repeated work.** If you notice the model writing the same helper script or taking the same multi-step approach every run, bundle that script in `scripts/` so the skill calls it via `Bash` instead of regenerating it.

- **Build in self-review checkpoints.** For multi-step pipelines where output could drift, have the skill save its draft to a file and spawn an `Agent` subagent (consider Opus for quality reviews) to read the SKILL.md plus the draft and flag where output drifts from the principles. The skill revises before continuing. Catches errors at the stage where they're cheapest to fix.

- **Externalize data that goes stale silently.** Current targets, headcount, contacts in roles that turn over — pull at runtime or read from a config. The user's own name, personal links, and durable past lessons are stable identity, not volatile data; hardcoding is fine, and for personal context skills it's often the whole point. Test: if this fact silently went stale tomorrow, would the skill produce wrong output? If yes, externalize.

- **Don't hardcode workspace paths.** Resolve the working directory at runtime. Hardcoding a specific folder name (`/Users/me/projects/foo`) breaks the skill the moment someone else uses it or the user reorganizes.

- **Don't ask what you can detect.** If the skill can detect something automatically (current branch, available MCP servers, repo language), detect it. Don't make the user tell you what your tools can already see.
