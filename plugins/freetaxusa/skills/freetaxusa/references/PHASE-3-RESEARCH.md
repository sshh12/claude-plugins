# Phase 3: Tax Research

## Tax Rule Research

Spawn Tasks to WebFetch current year data. Each item below must be looked up and recorded with the specific dollar amount or percentage for the current filing year:

### Tax Brackets & Deductions
- IRS standard deduction amounts (single, married filing jointly, married filing separately, head of household)
- Federal income tax brackets for all filing statuses
- SALT (state and local tax) deduction cap, including the Married Filing Separately cap

### Penalties & Thresholds
- IRS underpayment penalty threshold (minimum amount owed after withholdings that triggers a penalty)
- Accuracy-related penalty percentage for substantial understatement
- Substantial understatement thresholds (both the percentage-of-tax threshold and the dollar threshold)

### Adjustments to Income
- Student loan interest deduction cap
- Educator expenses deduction cap
- HSA contribution limits (self-only and family coverage)

### Itemized Deduction Thresholds
- Medical expenses AGI floor percentage (the percentage of AGI above which medical expenses are deductible)

### Credits
- American Opportunity Credit maximum amount
- Lifetime Learning Credit maximum amount
- Child Tax Credit amount per child and phase-out thresholds
- Earned Income Tax Credit (EITC) amounts and phase-out thresholds by filing status and number of children
- Child and Dependent Care Credit limits
- Retirement Savings Contributions Credit (Saver's Credit) income thresholds

### Reporting Thresholds
- FBAR (FinCEN Form 114) aggregate foreign account reporting threshold

### Other
- State-specific tax rules for the user's state(s)
- Any relevant recent tax law changes affecting the current filing year

Store fetched data in the extraction folder as `tax-rules-reference.md` for use during filing.

## Life Change Questionnaire

Life change answers frequently reveal missing documents. After the questionnaire, loop back to Phase 2 if new documents are needed (e.g., user mentions a home sale → request the closing statement; user mentions crypto → request exchange exports). Re-extract, update the consolidated summary, and return here before continuing.

Use AskUserQuestion to ask about life changes that affect taxes:

- Marriage or divorce during the tax year?
- New dependents (birth, adoption)?
- Home purchase or sale?
- Job change, layoff, or unemployment?
- Move between states?
- Retirement account distributions or contributions (IRA, 401k, Roth conversions)?
- HSA contributions or distributions?
- Education expenses (tuition, student loans)?
- Significant medical expenses?
- Charitable donations (cash or non-cash)?
- Foreign income or foreign bank accounts?
- Cryptocurrency transactions?
- Rental property income?
- Self-employment or freelance income?
- Childcare or dependent care expenses?
- Energy improvements (solar panels, EV purchase)?
- Disability or change in health insurance?
- Death of spouse or dependent?
- Any IRS notices or prior audit history?

## Complexity Flags

If any of the following apply, recommend the user consult a human tax professional:

| Flag | Why It Is Risky |
|------|----------------|
| Alternative Minimum Tax (AMT) exposure from large ISO exercises (Form 3921 with significant spread) | AMT calculations are complex and errors can result in large unexpected tax bills |
| Multi-state allocation (lived/worked in 3+ states) | State apportionment rules vary widely and mistakes cause double-taxation or missed credits |
| Significant self-employment or business income (Schedule C likely) | Deduction rules, estimated tax payments, and SE tax add substantial complexity |
| Foreign tax credits or FBAR (FinCEN Form 114 — Report of Foreign Bank Accounts) requirements (aggregate foreign accounts over the FBAR reporting threshold — verify current amount from Phase 3 tax rules research) | Severe penalties for non-compliance; complex reporting. Note: FBAR is filed separately with FinCEN, not through FreeTaxUSA. |
| Complex K-1 / trust income with unusual allocations | Pass-through items often require professional interpretation |
| Prior audit history or outstanding IRS notices | Existing IRS interactions need careful handling |
| Rental property with depreciation | Depreciation schedules and passive activity rules are error-prone |
| Large capital loss carryforwards from prior years | Must be tracked accurately across years |

Explain why each is flagged and what the risks are. Let the user decide whether to proceed or seek professional help.

## Filing Plan

Build a section-by-section table mapping the filing:

```
| FreeTaxUSA Section | Source Documents | Key Entries | Special Handling |
|--------------------|-----------------|-------------|------------------|
| Personal Info | Prior return | Name, SSN, address | Verify current address |
| Income > Wages | W-2 (Acme Corp) | Boxes 1-20 | Check Box 12 codes |
| Income > Interest | 1099-INT (Bank) | Interest amount | |
| Income > Dividends | 1099-DIV (Schwab) | Ordinary + qualified | |
| Income > Stock Sales | 1099-B (Schwab) | Proceeds, basis | Check for wash sales |
| Deductions | Various | Standard or itemized | Compare both options |
| Credits | Eligibility docs | Applicable credits | Verify phase-outs |
| State | All above | State allocation | Check residency rules |
```

Review this plan with the user via AskUserQuestion before proceeding to Phase 4. Confirm every section maps to at least one source document and that no documents are unaccounted for.

**If the review reveals gaps** (unmapped documents, missing source docs for a section, unresolved questions), loop back to Phase 2 to collect additional documents or Phase 3 questionnaire to clarify. Do NOT proceed to Phase 4 until the filing plan is complete and approved.
