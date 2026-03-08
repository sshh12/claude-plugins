# Phase 1: Setup & Consent

## What is FreeTaxUSA?

- Free federal tax filing service (freetaxusa.com). State returns cost a small fee.
- This skill automates form filling — it is NOT affiliated with FreeTaxUSA.

## Important Legal Disclaimers

Present these clearly to the user before proceeding:

- **Not a tax professional.** This is an AI assistant, not a CPA, enrolled agent, tax attorney, or any kind of licensed tax professional. It cannot provide tax advice, legal advice, or professional opinions.
- **Not tax advice.** Nothing in this session constitutes tax advice. The skill fills in forms based on documents you provide and general tax rules it looks up. It does not evaluate whether your tax positions are correct, optimal, or defensible.
- **No professional liability.** Unlike a CPA or tax preparer, there is no professional liability insurance, no preparer tax identification number (PTIN), and no regulatory body overseeing this tool. If errors result in penalties, interest, or audit costs, there is no recourse against the tool.
- **You are the preparer.** By using this skill, you are self-preparing your return. The IRS considers you the taxpayer and preparer — you bear full legal responsibility for everything on the return.
- **When in doubt, consult a professional.** If your tax situation involves anything complex, unusual, or high-stakes, consult a licensed CPA or enrolled agent. This skill will flag known complexity items in Phase 3, but it cannot identify every situation that warrants professional help.
- **Not affiliated with FreeTaxUSA.** This skill is an independent automation tool. FreeTaxUSA, TaxHawk Inc., and the IRS have no involvement with or endorsement of this skill.

## Risks of Tax Inaccuracy

Explain these clearly for non-tax-savvy users:

**Underpayment penalty**: If you owe more than the IRS underpayment threshold after withholdings (verify current threshold from Phase 3 tax rules research), the IRS charges penalties plus interest on the unpaid amount.

**Accuracy-related penalty**: The IRS imposes a penalty on underpaid tax for "substantial understatement" — verify the current penalty percentage, understatement percentage threshold, and dollar threshold from Phase 3 tax rules research.

**IRS matching**: The IRS receives copies of all W-2s and 1099s from employers and institutions. If your return does not match their records, expect a CP2000 notice (proposed adjustment letter).

**Audit risk**: While rare for simple returns, errors and inconsistencies increase audit likelihood.

### Common Error Categories

- Missed income (forgot a 1099, side gig, crypto transactions)
- Wrong deduction choice (standard vs itemized)
- Incorrect state income allocation (especially for remote workers)
- Missing or wrong withholding amounts

## What to Review Carefully

- Income totals per source — must match every W-2/1099
- Deduction choice (standard vs itemized) and amounts
- Credits claimed — eligibility verified
- State income allocation — especially if multi-state
- Withholdings — match W-2 Box 2 plus estimated payments
- Total tax — sanity check against effective rate for income level

## Load Browser Automation

1. **Try brw first (strongly recommended):** Use the Skill tool to load the `brw` skill: `skill: "brw"`
2. **If brw loads successfully:** read brw's Quick Mode reference file — essential for efficient multi-field form filling in Phase 4. The brw skill itself provides all command usage details; do not duplicate them here.
3. **If brw is not available:** Do NOT halt. Instead, ask the user what browser automation they have available:
   - Claude for Chrome extension
   - Playwright MCP server
   - Chrome DevTools MCP server
   - Other browser automation tool
4. **If an alternative is available:** warn the user: "The browser tips and patterns in this skill are written for the brw skill. They should mostly transfer to your browser tool, but some commands may need adaptation. For the best experience, consider installing brw: `/plugin install brw@shrivu-plugins`". Then continue with whatever browser tool is available.
5. **If NO browser automation is available at all:** HALT and tell the user: "Browser automation is required for tax filing. Install the brw plugin with: `/plugin install brw@shrivu-plugins`, or set up another browser automation tool (Claude for Chrome, Playwright MCP, Chrome DevTools MCP)."

## Data Privacy Notice

Where data is stored during the filing session:

| Location | Contents |
|----------|----------|
| Conversation context | Document contents discussed in the conversation (stored in ~/.claude history). **This includes SSNs, EINs, and financial data from extracted documents.** |
| Extraction folder | User-chosen folder containing extracted text and images from tax documents. **These files contain SSNs, income amounts, and other PII in plain text.** |
| Screenshots | Temporary screenshots of FreeTaxUSA pages (e.g., /tmp/brw-screenshots/ for brw) |
| Chrome profile | Login cookies stored in the browser automation's Chrome profile (e.g., ~/.config/brw/chrome-data/ for brw) |

None of this data is sent anywhere except FreeTaxUSA via the browser session.

### Sensitive Data Handling

**SSNs and bank account numbers require special care:**
- The user should enter SSNs and bank routing/account numbers **directly into the browser themselves** rather than through the agent. Treat these like login credentials — the agent should not handle them.
- When extracting documents, SSNs will appear in text files. The purge reminder (and Phase 5 cleanup) must specifically call this out.
- In document summaries, redact SSNs to show only the last 4 digits (e.g., XXX-XX-1234).
- Never repeat full SSNs or bank account numbers in conversation text.

## Purge Reminder

Mention that a `~/Desktop/tax-data-purge-reminder.md` file will be created in Phase 2 (as soon as the extraction folder is set up) with specific cleanup commands for all sensitive data. Creating it early ensures the reminder exists even if the session is interrupted.

## Consent

Use AskUserQuestion:

> "I've explained the risks and data handling. Do you want to proceed with tax filing? (yes/no)"

Do NOT proceed without explicit "yes".
