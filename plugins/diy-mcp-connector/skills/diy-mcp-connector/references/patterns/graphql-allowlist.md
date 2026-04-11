# Pattern: GraphQL Allowlisting

Load this reference when Stage 2 detects that the GraphQL API uses **query allowlisting** (also called persisted queries). This means the server only accepts exact query strings registered in its allowlist — any modification (adding, removing, or reordering fields) is rejected.

## How to confirm this classification

Run these diagnostic steps during Stage 2:

1. **Send a minimal introspection query.** `{ __typename }` is valid GraphQL that every non-allowlisted server accepts. If it returns 500, the server likely rejects arbitrary queries.

2. **Send a field-subset query.** Take a captured query from the SPA, remove one field, and send it. If the original returns 200 but the subset returns 500, the server is matching exact query strings.

3. **Check for `persistedQuery` in request bodies.** Some implementations use Apollo's automatic persisted queries (APQ) — the request body contains `extensions.persistedQuery.sha256Hash` instead of (or alongside) a `query` field.

4. **The 500 vs 400 distinction.** A `400 Bad Request` usually means GraphQL syntax error (malformed query). A `500 Internal Server Error` on a syntactically valid query usually means allowlisting or a server-side issue. If only SPA-captured queries return 200 and all modified queries return 500, it's allowlisting.

## Impact on build

When allowlisting is detected, the build strategy changes fundamentally. **You cannot compose new queries. You must capture and replay the SPA's exact queries.**

### Step 1: Capture exact query strings

Use CDP `Network.requestWillBeSent` to capture the full request body (the `postData` field) for every GraphQL call the SPA makes. The body contains:

```json
{
  "operationName": "GetProjectDetails",
  "query": "query GetProjectDetails($id: ID!) { project(id: $id) { id name members { id name } ... } }",
  "variables": { "id": "123" }
}
```

Alternatively, extract from HAR files — the request body is in `entries[].request.postData.text`.

### Step 2: Store queries as constants

Store each captured query as a constant string in the server. Do not modify the query text in any way — no field additions, no field removals, no whitespace changes, no reordering.

```js
const QUERIES = {
  GetProjectDetails: `query GetProjectDetails($id: ID!) {
  project(id: $id) {
    id
    name
    members {
      id
      name
      role
    }
    recentActivity {
      id
      type
      timestamp
    }
  }
}`,
  SearchIssues: `query SearchIssues($filter: IssueFilter!) { ... }`,
};
```

### Step 3: Use queries verbatim

Tool handlers send the exact captured query with only the variables changed:

```js
const data = await graphql.query(QUERIES.GetProjectDetails, {
  variables: { id: args.project_id }
});
```

### Step 4: Handle unused fields in responses

Since you can't trim queries, responses may include fields the tool doesn't need. Filter the response data in the tool handler before returning — strip noise fields, extract the relevant subset, and format for readability.

## APQ (Automatic Persisted Queries)

If the app uses Apollo APQ, requests contain a hash instead of the full query:

```json
{
  "operationName": "GetProject",
  "variables": { "id": "123" },
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "abc123..."
    }
  }
}
```

In this case, you can send the hash instead of the query text. Capture the hash from the SPA's requests and store it alongside the query:

```js
const QUERIES = {
  GetProjectDetails: {
    hash: 'abc123...',
    // Keep the full query as documentation, but send the hash
    query: `query GetProjectDetails(...) { ... }`,
  },
};
```

Send with the hash:
```js
const data = await graphql.queryByHash(
  QUERIES.GetProjectDetails.hash,
  'GetProjectDetails',
  { id: args.project_id }
);
```

## Tool design implications

- **Fewer, broader tools.** Since each tool is locked to specific captured queries, design tools around the queries you have, not the queries you wish you had. If the SPA doesn't make a "search by status" query, you can't add one.
- **Document what's available.** Tool descriptions should clearly state what filters/parameters are available based on the captured queries' variable definitions.
- **Coverage depends on capture completeness.** Make Stage 1 capture thorough — navigate every major section of the app to trigger all the queries you'll need.
