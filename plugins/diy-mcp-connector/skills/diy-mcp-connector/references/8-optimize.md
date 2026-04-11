# Stage 8: Optimize

Review Claude CLI logs and evaluation results from Stage 7. Fix issues, then retest until metrics are stable.

## Symptom-Fix Table

| Symptom | Fix |
|---|---|
| Redundant tool calls (same tool called multiple times for one question) | Consolidate — return more data per call. If users always search then get details, combine into one tool that returns enriched results. |
| Wrong tool selected | Improve the tool description — be more specific about **when** to use it and what data it returns. Add negative guidance ("Do not use this for X"). |
| Large responses bloating context window | Switch to `resource_link` for payloads over the inline threshold. Add a `limit` parameter with a sensible default. |
| Parameter errors / hallucinated values | Clarify parameter descriptions, add concrete examples in the description, use `enum` for fixed value sets. |
| Tool not being used at all | The description does not match the user's vocabulary. Rewrite to use the words users actually say, not internal API terminology. |

## Response Size Guidelines

| Data type | Typical size | Strategy |
|---|---|---|
| List/search results | 2-10 KB | Inline (default). Keep responses concise — return key fields, not full objects. |
| Detail views | 5-50 KB | Threshold-based. Under `MCP_INLINE_THRESHOLD` (default 8 KB) goes inline; over goes to file. |
| Documents, transcripts, logs | 50 KB+ | Always file with `resource_link`. Never inline — these consume too much context. |
| Reports, exports | Variable | Always file. Use CSV for tabular data, markdown for formatted reports. |

When switching a tool from inline to file output, update the tool description to mention that results are saved to a file and suggest calling `set_output_dir` first.

## Token Savings Estimate

Compare MCP tool calls versus browser automation for common tasks. This helps the user understand the ROI of the MCP server.

For each designed tool, estimate:
- **(a) Tokens per MCP call:** tool input JSON (~50-200 tokens) + structured JSON response (~200-2000 tokens depending on data size)
- **(b) Tokens via browser automation:** navigate (~100 tokens) + screenshot (~800 tokens per image) + read-page (~2000-5000 tokens per page of DOM) + click/type sequences (~100 tokens each action)

Example comparison table:

| Task | MCP tokens | Browser tokens | Savings |
|---|---|---|---|
| Search for items | ~300 (query + results) | ~3500 (navigate + screenshot + read list) | ~91% |
| Get item details | ~500 (ID + detail JSON) | ~6000 (navigate + screenshot + read page + scroll) | ~92% |
| Search + get top 3 details | ~1800 (search + 3 detail calls) | ~22000 (navigate + read + 3x click + read + scroll) | ~92% |
| List with filters | ~400 (params + filtered results) | ~4500 (navigate + fill filters + screenshot + read) | ~91% |

For a typical session of 5-10 queries:
- **MCP total:** ~3000-8000 tokens
- **Browser total:** ~30000-60000 tokens
- **Cumulative savings:** ~80-90% token reduction

Present this table to the user with actual estimates based on their app's data sizes. The savings compound significantly in multi-query sessions where browser automation requires repeated navigation.

## Iteration Cycle

After identifying issues:

1. **Redesign** — update tool names, descriptions, schemas, or response formats based on the symptom-fix table
2. **Rebuild** — modify the tool handlers in `server/index.js` to match the new design
3. **Retest** — run the full Stage 7 test suite again (stdio, consistency check, Claude CLI pressure, evaluation)

Repeat until:
- No redundant tool calls in typical workflows
- Correct tool selected on first attempt for all test categories
- All responses are appropriately sized (inline for small, file for large)
- Error rate is near zero across test prompts

Do not move to Stage 9 until the optimization cycle produces stable results across two consecutive test runs.
