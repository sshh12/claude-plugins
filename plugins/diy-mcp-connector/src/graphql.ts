// graphql.ts — GraphQL client factory for generated MCP servers.
//
// Copied into `server/graphql.js` when the target app uses a GraphQL API.
// Handles authentication failures transparently — both explicit error codes
// and the sneaky "200 OK with all-null data" pattern.
//
// ## GraphQL gotchas to keep in mind
//
// 1. **Unused variables cause 500s.** If your query declares `$foo: String`
//    but no field references `$foo`, many servers reject it with a generic 500.
//    Only declare variables your query body actually uses.
//
// 2. **Nullable arguments != "return all."** A field like
//    `itemsByCategory(categoryId: ID)` that accepts `null` may return empty
//    results, not all items. Test with `null` early — you may need a different
//    query path (e.g., fetch IDs first, then batch-fetch details).
//
// 3. **Truncated HAR fragments.** The HAR analyzer may truncate long queries.
//    Before assuming a field exists, verify against the live API — request a
//    minimal set of fields first, then add more incrementally.

import type {
  AuthFetchFn,
  AuthFetchResult,
  ClearCookiesFn,
  GraphQLClientConfig,
  GraphQLResponse,
} from "./types.js";

/**
 * Create a GraphQL query function bound to a specific domain and auth context.
 */
export function createGraphQLClient({
  domain,
  loginUrl,
  authFetch,
  clearCookies,
}: GraphQLClientConfig): (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<Record<string, unknown> | undefined> {
  /**
   * Execute a GraphQL query against the configured endpoint.
   */
  async function gql(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> | undefined> {
    const response = await execute(query, variables);
    const body = response.body as GraphQLResponse | undefined;

    if (isAuthFailure(response)) {
      clearCookies(domain);
      const retry = await execute(query, variables, { forceLogin: true });
      const retryBody = retry.body as GraphQLResponse | undefined;

      if (retryBody?.errors?.length) {
        const messages = retryBody.errors.map((e) => e.message).join("; ");
        throw new Error(`GraphQL error after re-auth: ${messages}`);
      }
      return retryBody?.data;
    }

    if (body?.errors?.length) {
      const messages = body.errors.map((e) => e.message).join("; ");
      throw new Error(`GraphQL error: ${messages}`);
    }

    return body?.data;
  }

  /**
   * Send a GraphQL POST request.
   */
  async function execute(
    query: string,
    variables: Record<string, unknown>,
    extra?: { forceLogin?: boolean },
  ): Promise<AuthFetchResult> {
    const url = `https://${domain}/graphql`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    };

    const result = await authFetch(url, options, loginUrl, extra);

    if (result.status !== 200) {
      throw new Error(
        `GraphQL HTTP ${result.status} ${result.statusText} from ${domain}`,
      );
    }

    return result;
  }

  /**
   * Detect whether a GraphQL response indicates an authentication failure.
   *
   * Two patterns are checked:
   *
   * 1. **Explicit error codes** — the `errors` array contains entries where
   *    `extensions.code === "FORBIDDEN"` or the message matches `/auth/i`.
   *
   * 2. **All-null data** — HTTP 200 with a `data` object where every top-level
   *    field is `null`. Some apps return this instead of proper error codes
   *    when the session has expired.
   */
  function isAuthFailure(response: AuthFetchResult): boolean {
    const body = response.body as GraphQLResponse | undefined;
    if (!body) return false;

    // Check for explicit auth errors in the errors array
    const hasAuthError = body.errors?.some(
      (e) =>
        e.extensions?.code === "FORBIDDEN" || /auth/i.test(e.message ?? ""),
    );
    if (hasAuthError) return true;

    // Check for the all-null-data pattern (200 OK but session expired)
    if (body.data) {
      const values = Object.values(body.data);
      if (values.length > 0 && values.every((v) => v === null)) {
        return true;
      }
    }

    return false;
  }

  return gql;
}
