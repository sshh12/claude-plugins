#!/usr/bin/env python3
"""
HAR file analyzer for MCP server development.

Parses HAR (HTTP Archive) files and extracts API surface information
to inform MCP tool design.

Usage:
    python3 analyze-har.py <har-file> --domain <domain>              # REST endpoints
    python3 analyze-har.py <har-file> --graphql                      # GraphQL operations
    python3 analyze-har.py <har-file> --graphql --extract             # GraphQL with queries + response shapes
    python3 analyze-har.py <har-file> --domain <domain> --summary     # Quick summary only
"""

import argparse
import json
import sys
from collections import defaultdict
from urllib.parse import urlparse, parse_qs


def load_har(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("log", {}).get("entries", [])


def parse_entry(entry):
    req = entry.get("request", {})
    resp = entry.get("response", {})
    url = req.get("url", "")
    parsed = urlparse(url)
    return {
        "method": req.get("method", ""),
        "url": url,
        "domain": parsed.hostname or "",
        "path": parsed.path,
        "query": parse_qs(parsed.query),
        "status": resp.get("status", 0),
        "content_type": resp.get("content", {}).get("mimeType", ""),
        "response_size": resp.get("content", {}).get("size", 0),
        "request_body": _get_post_body(req),
        "response_body": _get_response_body(resp),
        "request_headers": {h["name"]: h["value"] for h in req.get("headers", [])},
    }


def _get_post_body(req):
    pd = req.get("postData", {})
    return pd.get("text", "")


def _get_response_body(resp):
    content = resp.get("content", {})
    return content.get("text", "")


def analyze_rest(entries, domain):
    """Group REST endpoints by method + path pattern."""
    endpoints = defaultdict(lambda: {
        "count": 0, "statuses": set(), "sizes": [],
        "content_types": set(), "example_url": "",
    })

    for e in entries:
        p = parse_entry(e)
        if domain and domain not in p["domain"]:
            continue
        if "graphql" in p["path"].lower():
            continue

        # Normalize path: replace numeric IDs with {id}
        path = p["path"].rstrip("/")
        parts = path.split("/")
        normalized = []
        for part in parts:
            if part.isdigit() or (len(part) > 8 and all(c in "0123456789abcdef-" for c in part)):
                normalized.append("{id}")
            else:
                normalized.append(part)
        norm_path = "/".join(normalized) or "/"

        key = f"{p['method']} {norm_path}"
        ep = endpoints[key]
        ep["count"] += 1
        ep["statuses"].add(p["status"])
        if p["response_size"] > 0:
            ep["sizes"].append(p["response_size"])
        ep["content_types"].add(p["content_type"].split(";")[0].strip())
        if not ep["example_url"]:
            ep["example_url"] = p["url"]

    return endpoints


def analyze_graphql(entries, extract=False):
    """Group GraphQL operations by operation name."""
    operations = defaultdict(lambda: {
        "count": 0, "statuses": set(), "sizes": [],
        "queries": [], "response_shapes": [],
    })

    for e in entries:
        p = parse_entry(e)
        if "graphql" not in p["path"].lower() and "graphql" not in p["url"].lower():
            continue
        if p["method"] != "POST":
            continue

        body = p["request_body"]
        if not body:
            continue

        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, TypeError):
            continue

        # Handle batched GraphQL (array of operations)
        payloads = payload if isinstance(payload, list) else [payload]

        for pl in payloads:
            op_name = pl.get("operationName", "anonymous")
            query = pl.get("query", "")
            variables = pl.get("variables", {})

            op = operations[op_name]
            op["count"] += 1
            op["statuses"].add(p["status"])
            if p["response_size"] > 0:
                op["sizes"].append(p["response_size"])

            if extract:
                if query and query not in [q["query"] for q in op["queries"]]:
                    op["queries"].append({"query": query, "variables": list(variables.keys())})

                resp_body = p["response_body"]
                if resp_body:
                    try:
                        resp_data = json.loads(resp_body)
                        shape = _extract_shape(resp_data.get("data", {}))
                        if shape and shape not in op["response_shapes"]:
                            op["response_shapes"].append(shape)
                    except (json.JSONDecodeError, TypeError):
                        pass

    return operations


def _extract_shape(obj, depth=0, max_depth=3):
    """Extract the shape of a JSON object (field names + types, truncated)."""
    if depth > max_depth:
        return "..."
    if obj is None:
        return "null"
    if isinstance(obj, bool):
        return "bool"
    if isinstance(obj, (int, float)):
        return "number"
    if isinstance(obj, str):
        return "string"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        return [_extract_shape(obj[0], depth + 1, max_depth)]
    if isinstance(obj, dict):
        result = {}
        for k, v in list(obj.items())[:15]:  # Limit fields shown
            result[k] = _extract_shape(v, depth + 1, max_depth)
        if len(obj) > 15:
            result["..."] = f"({len(obj) - 15} more fields)"
        return result
    return str(type(obj).__name__)


def identify_auth_pattern(entries, domain):
    """Detect authentication patterns from request headers."""
    patterns = set()
    for e in entries:
        p = parse_entry(e)
        if domain and domain not in p["domain"]:
            continue
        headers = p["request_headers"]
        h_lower = {k.lower(): v for k, v in headers.items()}
        if "authorization" in h_lower:
            val = h_lower["authorization"]
            if val.startswith("Bearer "):
                patterns.add("Bearer token (OAuth/JWT)")
            elif val.startswith("Basic "):
                patterns.add("Basic auth")
            else:
                patterns.add(f"Authorization: {val[:20]}...")
        if "x-csrf-token" in h_lower or "x-csrftoken" in h_lower:
            patterns.add("CSRF token (likely Rails/Django)")
        if "cookie" in h_lower:
            patterns.add("Session cookies")
        if "x-api-key" in h_lower:
            patterns.add("API key header")
    return patterns or {"No auth headers detected"}


def format_size(size):
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def print_rest(endpoints, domain):
    print(f"\n{'=' * 70}")
    print(f"REST API Surface{f' ({domain})' if domain else ''}")
    print(f"{'=' * 70}\n")

    if not endpoints:
        print("No REST endpoints found.")
        return

    sorted_eps = sorted(endpoints.items(), key=lambda x: -x[1]["count"])

    print(f"{'Endpoint':<50} {'Calls':>5} {'Status':>10} {'Avg Size':>10}")
    print(f"{'-' * 50} {'-' * 5} {'-' * 10} {'-' * 10}")

    for key, ep in sorted_eps:
        avg_size = sum(ep["sizes"]) / len(ep["sizes"]) if ep["sizes"] else 0
        statuses = ",".join(str(s) for s in sorted(ep["statuses"]))
        print(f"{key:<50} {ep['count']:>5} {statuses:>10} {format_size(avg_size):>10}")

    print(f"\nTotal: {len(endpoints)} unique endpoints, {sum(e['count'] for e in endpoints.values())} requests")


def print_graphql(operations, extract=False):
    print(f"\n{'=' * 70}")
    print("GraphQL Operations")
    print(f"{'=' * 70}\n")

    if not operations:
        print("No GraphQL operations found.")
        return

    sorted_ops = sorted(operations.items(), key=lambda x: -x[1]["count"])

    for name, op in sorted_ops:
        avg_size = sum(op["sizes"]) / len(op["sizes"]) if op["sizes"] else 0
        statuses = ",".join(str(s) for s in sorted(op["statuses"]))
        print(f"  {name}")
        print(f"    Calls: {op['count']}  Status: {statuses}  Avg response: {format_size(avg_size)}")

        if extract and op["queries"]:
            for i, q in enumerate(op["queries"][:2]):  # Show max 2 query variants
                print(f"    Variables: {', '.join(q['variables']) or '(none)'}")
                # Truncate long queries
                query_text = q["query"]
                if len(query_text) > 500:
                    query_text = query_text[:500] + "\n      ... (truncated)"
                indented = "\n".join(f"      {line}" for line in query_text.strip().split("\n"))
                print(f"    Query:\n{indented}")

        if extract and op["response_shapes"]:
            for shape in op["response_shapes"][:1]:  # Show first shape only
                shape_json = json.dumps(shape, indent=2)
                indented = "\n".join(f"      {line}" for line in shape_json.split("\n"))
                print(f"    Response shape:\n{indented}")

        print()

    print(f"Total: {len(operations)} unique operations, {sum(o['count'] for o in operations.values())} requests")


def print_summary(entries, domain):
    """Quick summary of the HAR file."""
    total = len(entries)
    domains = set()
    methods = defaultdict(int)
    for e in entries:
        p = parse_entry(e)
        domains.add(p["domain"])
        methods[p["method"]] += 1

    auth = identify_auth_pattern(entries, domain)

    print(f"\n{'=' * 70}")
    print("HAR Summary")
    print(f"{'=' * 70}\n")
    print(f"Total requests: {total}")
    print(f"Unique domains: {len(domains)}")
    if domain:
        matching = sum(1 for e in entries if domain in parse_entry(e)["domain"])
        print(f"Matching '{domain}': {matching}")
    print(f"Methods: {dict(methods)}")
    print(f"Auth patterns: {', '.join(sorted(auth))}")
    print(f"\nDomains seen:")
    for d in sorted(domains):
        count = sum(1 for e in entries if parse_entry(e)["domain"] == d)
        print(f"  {d} ({count} requests)")


def main():
    parser = argparse.ArgumentParser(
        description="Analyze HAR files to map API surfaces for MCP tool design.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s capture.har --domain myapp.com           REST endpoints for myapp.com
  %(prog)s capture.har --graphql                     GraphQL operation names
  %(prog)s capture.har --graphql --extract            GraphQL with full queries + shapes
  %(prog)s capture.har --domain myapp.com --summary   Quick overview
        """,
    )
    parser.add_argument("har_file", help="Path to HAR file")
    parser.add_argument("--domain", help="Filter by domain (substring match)")
    parser.add_argument("--graphql", action="store_true", help="Analyze GraphQL operations")
    parser.add_argument("--extract", action="store_true", help="Extract full queries and response shapes (requires --graphql)")
    parser.add_argument("--summary", action="store_true", help="Show quick summary only")

    args = parser.parse_args()

    if args.extract and not args.graphql:
        parser.error("--extract requires --graphql")

    try:
        entries = load_har(args.har_file)
    except FileNotFoundError:
        print(f"Error: File not found: {args.har_file}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in HAR file: {e}", file=sys.stderr)
        sys.exit(1)

    if not entries:
        print("No entries found in HAR file.", file=sys.stderr)
        sys.exit(1)

    if args.summary:
        print_summary(entries, args.domain)
        return

    if args.graphql:
        operations = analyze_graphql(entries, extract=args.extract)
        print_graphql(operations, extract=args.extract)
    else:
        if not args.domain:
            print("Tip: Use --domain <domain> to filter by app domain, or --graphql for GraphQL.", file=sys.stderr)
        endpoints = analyze_rest(entries, args.domain)
        print_rest(endpoints, args.domain)

    # Always show auth patterns
    auth = identify_auth_pattern(entries, args.domain)
    print(f"\nAuth patterns detected: {', '.join(sorted(auth))}")


if __name__ == "__main__":
    main()
