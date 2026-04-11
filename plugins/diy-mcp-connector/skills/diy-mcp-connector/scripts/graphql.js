// src/graphql.ts
function createGraphQLClient({
  domain,
  loginUrl,
  authFetch,
  clearCookies
}) {
  async function gql(query, variables = {}) {
    const response = await execute(query, variables);
    const body = response.body;
    if (isAuthFailure(response)) {
      clearCookies(domain);
      const retry = await execute(query, variables, { forceLogin: true });
      const retryBody = retry.body;
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
  async function execute(query, variables, extra) {
    const url = `https://${domain}/graphql`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables })
    };
    const result = await authFetch(url, options, loginUrl, extra);
    if (result.status !== 200) {
      throw new Error(
        `GraphQL HTTP ${result.status} ${result.statusText} from ${domain}`
      );
    }
    return result;
  }
  function isAuthFailure(response) {
    const body = response.body;
    if (!body) return false;
    const hasAuthError = body.errors?.some(
      (e) => e.extensions?.code === "FORBIDDEN" || /auth/i.test(e.message ?? "")
    );
    if (hasAuthError) return true;
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
export {
  createGraphQLClient
};
