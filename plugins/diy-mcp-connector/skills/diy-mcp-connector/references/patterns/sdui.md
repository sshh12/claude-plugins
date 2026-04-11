# Pattern: Server-Driven UI (SDUI)

Load this reference when Stage 2 analysis reveals that API responses contain **component trees or layout descriptors** rather than flat data. SDUI is common in mobile-first apps (DoorDash, Airbnb, CookUnity) where the server dictates page layout and the client renders it.

## How to identify SDUI

Look for these signals in API response shapes:

1. **Component-type fields.** Responses contain objects with `type`, `component`, `__typename`, or `template` fields that describe UI elements:
   ```json
   {
     "type": "HeroCarousel",
     "children": [
       { "type": "ProductCard", "props": { "title": "...", "price": "..." } }
     ]
   }
   ```

2. **Nested layout structures.** Deeply nested objects describing rows, columns, sections, grids — structure that maps to visual layout, not domain data.

3. **Mixed data and presentation.** Fields like `backgroundColor`, `iconUrl`, `ctaText`, `layoutHint` mixed in with actual data fields like `name`, `price`, `id`.

4. **Generic endpoint names.** Endpoints like `/api/screen`, `/api/page`, `/graphql` with operations like `GetHomeScreen`, `GetMenuPage` — named after screens, not domain entities.

## Impact on tool design

SDUI responses require **recursive tree walking** to extract meaningful data. This is qualitatively different from flat JSON parsing — you can't just access `response.data.items`.

### Extraction strategy

Write a helper that recursively walks the component tree and extracts data by component type:

```js
function extractFromTree(node, targetTypes) {
  const results = [];

  if (targetTypes.includes(node.type || node.__typename)) {
    results.push(node.props || node.data || node);
  }

  const children = node.children || node.items || node.sections || [];
  for (const child of children) {
    results.push(...extractFromTree(child, targetTypes));
  }

  return results;
}

// Usage in a tool handler:
const raw = await authFetch('/api/home-screen');
const products = extractFromTree(raw.data, ['ProductCard', 'MenuItemCard']);
```

### What to return from tools

Return the **extracted domain data**, not the component tree. The user asking "what meals are available?" wants names and prices, not a `HeroCarousel` with `GridLayout` children.

```js
// Bad: returning the raw SDUI response
return output.buildResponse(raw.data, { ... });

// Good: extracting and flattening
const items = extractFromTree(raw.data, ['MenuItemCard']).map(item => ({
  id: item.id,
  name: item.title || item.name,
  price: item.price,
  description: item.subtitle || item.description,
}));
return output.buildResponse(items, { ... });
```

### Tool design implications

- **Map tools to screens, then extract.** If the API is screen-based, each tool may map to a screen endpoint. But the tool should extract and return domain data, not the screen layout.
- **Document which component types you extract.** When the app updates its SDUI schema (adds new component types), the extraction may miss data. Note the known component types as constants so they're easy to update.
- **Watch for pagination inside trees.** Some SDUI responses paginate within the component tree — a `LoadMoreButton` component signals there's more data. Handle this in the tool handler by following the pagination token.

## Impact on build

### Additional helper

Add a `sdui.js` helper to the server that provides tree-walking utilities:

```js
// sdui.js
export function extractByType(tree, types) { ... }
export function flattenTree(tree) { ... }
export function findFirst(tree, type) { ... }
```

Import it in tool handlers that deal with SDUI responses.

### Response size

SDUI responses are often large (50-200KB) because they include the full page layout. After extraction, the relevant data is usually much smaller. Always extract before passing to `output.buildResponse` — don't send the raw tree through the output pipeline.
