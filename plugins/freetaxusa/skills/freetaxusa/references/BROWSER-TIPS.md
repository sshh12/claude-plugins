# Browser Tips for FreeTaxUSA

> **Note:** These tips are written for the brw skill, but the general patterns — text reads over screenshots, JS for bulk fills, verification via form value dumps — apply to any browser automation tool. Adapt the specific commands to your tool as needed.

The brw skill provides command-level documentation. This file focuses on FreeTaxUSA-specific site behavior and automation patterns.

## General Strategy

- Prefer text-based page reads over screenshots for speed — text reads are 3-5x faster than screenshot plus visual analysis
- Use interactive-filtered reads to see all form fields, radios, dropdowns on a page
- Use page title/headings to identify which FreeTaxUSA page you are on

## Form Filling

- Use JS for bulk form fills — set multiple field values at once and dispatch change/input events
- Use IIFE pattern for JS execution: `void function(){...}()` to avoid variable redeclaration errors across page loads (JS context persists within a tab)
- FreeTaxUSA currency fields auto-round to whole dollars — always enter integers, never decimals
- Yes/No radio button pages BLOCK the Save button if neither option is selected — click all "No" radios first, then change specific ones to "Yes"

### JS Bulk Fill Example

```javascript
void function(){
  var fields = {
    'fieldName1': 'value1',
    'fieldName2': 'value2'
  };
  Object.keys(fields).forEach(function(name){
    var el = document.querySelector('[name="'+name+'"]');
    if(el){ el.value = fields[name]; el.dispatchEvent(new Event('change',{bubbles:true})); }
  });
}()
```

### JS Verification Pattern

Before saving a page, dump all form values to verify:

```javascript
void function(){
  var result = {};
  document.querySelectorAll('input,select,textarea').forEach(function(el){
    if(el.name) result[el.name] = el.type==='checkbox'||el.type==='radio' ? el.checked : el.value;
  });
  JSON.stringify(result, null, 2);
}()
```

## Navigation

- "Save and Continue" button is often below the fold — scroll down or use text-based clicking
- Loading spinners (2-4 seconds) appear after saves — always wait for network idle before interacting with the next page
- FreeTaxUSA follows a strict linear flow: Personal Info > Income > Deductions/Credits > Miscellaneous > Summary > State > Final Review
- Sidebar navigation may not work for jumping between major sections — follow the linear flow
- beforeunload dialogs: FreeTaxUSA sets these on pages with unsaved changes — clear with JS (`window.onbeforeunload = null`) before attempting back navigation

## Element Handling

- Element refs expire after page transitions — always get fresh page reads on each new page
- Some dropdowns may not respond to programmatic value-setting — fall back to click-based interaction if JS approach fails
- Radio buttons: use `.click()` rather than setting `.checked` to ensure associated event handlers fire

## Efficiency

- Use Quick Mode for multi-field form pages — batch fills plus clicks plus waits in a single call
- Use the JS verification pattern before saving: dump all form name/value pairs and compare against source docs
- For pages with many fields, read the page once, plan all entries, then fill all at once

## Error Recovery

- If a page seems stuck, try scrolling to find hidden elements or buttons
- If Chrome disconnects, brw auto-reconnects (other tools may require manual reconnection) — just retry the command
- FreeTaxUSA auto-saves per page, so re-login resumes where you left off
- If a page shows an unexpected error message, read the full page text to understand the issue before retrying
