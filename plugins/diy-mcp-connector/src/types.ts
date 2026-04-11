// Shared type definitions for diy-mcp-connector template scripts.

import type { ChildProcess } from "node:child_process";

// -- Auth module types --------------------------------------------------------

export interface AuthFetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  url: string;
  redirected: boolean;
  elapsed_ms: number;
}

export interface AuthFetchExtraOptions {
  forceLogin?: boolean;
  validateFn?: (cookieHeader: string) => Promise<boolean>;
}

export type AuthFetchFn = (
  url: string,
  options?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  loginUrl?: string,
  extra?: AuthFetchExtraOptions,
) => Promise<AuthFetchResult>;

export type ClearCookiesFn = (domain: string) => void;

export interface CDPCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: string;
}

export interface CDPPage {
  id: string;
  url: string;
  webSocketDebuggerUrl?: string;
  title?: string;
  type?: string;
}

export interface CDPVersionInfo {
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

export interface CDPMessage {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  params?: unknown;
}

export interface CookieData {
  domain: string;
  cookieHeader: string;
  raw: CDPCookie[];
  captured_at: string;
}

export { ChildProcess };

// -- Output module types ------------------------------------------------------

export interface BuildResponseOptions {
  type: string;
  id: string;
  inline?: boolean | string;
  format?: "json" | "markdown" | "text" | "csv";
  summary?: string;
}

export interface BuildFileResponseOptions {
  summary?: string;
  mimeType?: string;
}

export interface MCPContentText {
  type: "text";
  text: string;
}

export interface MCPContentResourceLink {
  type: "resource_link";
  uri: string;
  name: string;
  mimeType: string;
}

export type MCPContent = MCPContentText | MCPContentResourceLink;

export interface MCPToolResult {
  content: MCPContent[];
}

// -- CSRF module types --------------------------------------------------------

export interface CsrfManagerConfig {
  domain: string;
  loginUrl: string;
  authFetch: AuthFetchFn;
  pageUrl: string;
  headerName?: string;
  metaName?: string;
}

export interface CsrfManager {
  ensureCsrf: () => Promise<string>;
  fetchWithCsrf: (
    url: string,
    options?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
  ) => Promise<AuthFetchResult>;
  clearToken: () => void;
}

// -- GraphQL module types -----------------------------------------------------

export interface GraphQLClientConfig {
  domain: string;
  loginUrl: string;
  authFetch: AuthFetchFn;
  clearCookies: ClearCookiesFn;
}

export interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{
    message: string;
    extensions?: { code?: string; [key: string]: unknown };
    [key: string]: unknown;
  }>;
}
