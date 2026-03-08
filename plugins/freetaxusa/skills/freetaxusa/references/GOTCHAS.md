# Known FreeTaxUSA Gotchas

## Multi-Entry Forms

Some form sections (e.g., W-2 Box 12 codes, Box 14 entries) use "Add Another Item" buttons to add extra rows. Before assuming only the visible fields exist, look for these buttons. You may need to click "Add Another" multiple times to enter all items.

## Informational Alert Pages

Certain entries trigger informational screens (high income notices, state-specific alerts, IRS rule explanations). These are NOT errors — they are just informational. Read them to understand context, then continue past them.

## Conditional Follow-Up Pages

Some entries trigger extra pages that are not in the standard flow. Examples:

- Entering state disability insurance (SDI) in W-2 Box 14 may trigger a state-specific follow-up
- High dividend income may trigger qualified dividend allocation pages
- Retirement distributions may trigger early withdrawal penalty questions

Expect the unexpected between main sections. Read each page carefully.

## Multi-State / Nonresident Flows

If an employer's address differs from the taxpayer's state of residence, FreeTaxUSA may trigger a part-year or nonresident flow.

CRITICAL: Answer these based on where work was actually performed, not the employer's mailing address. Getting this wrong can misallocate ALL income to the wrong state.

## Dropdown Behavior

Some dropdowns may not respond to programmatic value-setting via JS. If setting `.value` and dispatching a `change` event does not work, fall back to:

1. Click the dropdown to open it
2. Click the desired option

Or use brw's form-fill command which handles this automatically.

## Pre-Filled / Carryforward Data

FreeTaxUSA may pre-fill fields from prior year data or imported returns. ALWAYS verify these values against current year source documents. Never trust pre-filled data — override with verified current year values.

## Session Timeouts

FreeTaxUSA sessions expire after extended inactivity. Watch for unexpected login page redirects. If this happens:

- Progress is auto-saved per page (anything you saved is safe)
- User needs to log back in
- Resume from where you left off

## Consolidated Brokerage 1099s

Documents like Schwab or Fidelity consolidated 1099s combine multiple form types (1099-B, 1099-DIV, 1099-INT, etc.) in one PDF. Parse each section separately and enter them in the corresponding FreeTaxUSA area (stock sales under Capital Gains, dividends under Dividends, etc.).

## Bulk Investment Transactions

For many stock/crypto transactions (dozens or hundreds), check if the brokerage supports CSV import into FreeTaxUSA rather than manual entry. FreeTaxUSA has import options for some brokerages.

## OCR vs Text Extraction Accuracy

Image-based reads of tax documents can have significant errors:

- Wrong dollar amounts (e.g., $45,123 read as $45,128)
- Misread issuer names
- Transposed digits in EINs or SSNs

ALWAYS cross-reference visual reads against raw text extraction. When they disagree, flag both values and ask the user to verify the correct one.

## "Do You Have Any More?" Gate Pages

After entering a W-2, 1099, or other form, FreeTaxUSA typically asks "Do you have another [form type] to enter?" This is a gate page — answer "No" when done with that form type, or "Yes" to add another. Missing this page or answering wrong can skip entire income sections or loop you back unnecessarily.

## Editing / Deleting Existing Entries

To edit or delete a previously entered form (e.g., a W-2 entered incorrectly), look for an "Edit" or "Delete" link on the section summary page. These can be small and easy to miss. FreeTaxUSA shows a list of entered items with edit/delete actions before the "Do you have any more?" gate.

## Currency Field Quirks

- FreeTaxUSA strips dollar signs and commas — enter plain integers
- Some fields may auto-format after you leave them (adding commas) — this is normal
- Verify the stored value, not the displayed format

## HSA Form 8889 Flow

The HSA section is often buried within Deductions rather than having its own top-level category. If the user has an HSA (W-2 Box 12 code W), make sure you reach the HSA section. It may appear as "Health Savings Account" under Adjustments or Deductions depending on the FreeTaxUSA flow.

## Investment Hub-and-Spoke Model

FreeTaxUSA's investment section may use a hub-and-spoke pattern: first add the brokerage institution, then add individual forms (1099-B, 1099-DIV, 1099-INT) under that institution. If you encounter this pattern, do not try to enter investment forms without first creating the institution entry. After entering all forms for one brokerage, return to the hub to add the next.

## Stock Sale Entry Options

When adding stock sales, FreeTaxUSA may offer multiple entry methods (individual transactions, CSV import, summary entry, etc.). Be cautious with any option that navigates away from the normal linear flow — it can be difficult to get back. Prefer individual transaction entry or CSV import. If an option seems to leave the expected flow, use browser back navigation to recover.

## JS `.value` Failures on Text Inputs

Setting `.value` directly via JS sometimes fails to register on certain text inputs — the field appears filled but the value is not saved on form submit. If this happens, fall back to clicking the field to focus it, clearing it, then typing the value character by character. This is slower but reliable. Test with a JS form value dump after filling to confirm values actually took.

## Upsell and Promotional Pages

FreeTaxUSA may insert upsell or promotional pages between major sections (upgrade offers, add-on services, etc.). These are not errors or required steps — read them briefly to confirm they're promotional, then click through. They can appear at any transition between sections.

## Unexpected Niche Tax Pages

Between main sections, FreeTaxUSA may show pages for uncommon tax situations (e.g., Qualified Opportunity Fund, foreign earned income, household employee taxes). For most filers these do not apply. Read the page title to confirm it's not relevant, answer "No" or skip, and continue. Do not be surprised by pages that weren't in the filing plan — just assess and move on.

## Radio Buttons Not Pre-Selected

Some pages (e.g., health insurance coverage, certain Yes/No gates) may load with NO radio button pre-selected. The Save button will be blocked until a selection is made. If Save seems unresponsive, check whether there's an unselected required radio group on the page.

## Pre-Existing Entries from Prior Attempts

If the user started filing before and has partial data, there may be stale entries from a prior attempt (income entered in the wrong category, outdated amounts, incomplete forms). Before adding new entries in any section, check the section summary page for existing items. Report any stale data found so the main conversation can decide whether to edit or delete before proceeding.
