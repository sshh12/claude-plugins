// ---- Configuration ----

export interface BrwConfig {
  proxyPort: number;
  cdpPort: number;
  chromeDataDir: string;
  chromePath: string | null;
  headless: boolean;
  screenshotDir: string;
  idleTimeout: number;
  windowWidth: number;
  windowHeight: number;
  allowedUrls: string[];
}

export type ConfigSource = 'env' | 'repo' | 'user' | 'default';

export interface ResolvedConfigEntry<T> {
  value: T;
  source: ConfigSource;
}

export type ResolvedConfig = {
  [K in keyof BrwConfig]: ResolvedConfigEntry<BrwConfig[K]>;
};

// ---- API Response ----

export interface PageInfo {
  url: string;
  title: string;
  contentLength: number;
}

export interface ApiResponse {
  ok: boolean;
  screenshot?: string;
  page?: PageInfo;
  error?: string;
  code?: string;
  hint?: string;
  [key: string]: unknown;
}

// ---- Tabs ----

export interface TabInfo {
  id: string;
  url: string;
  title: string;
}

// ---- Error Codes ----

export const ErrorCode = {
  TAB_NOT_FOUND: 'TAB_NOT_FOUND',
  SELECTOR_NOT_FOUND: 'SELECTOR_NOT_FOUND',
  REF_NOT_FOUND: 'REF_NOT_FOUND',
  URL_BLOCKED: 'URL_BLOCKED',
  TIMEOUT: 'TIMEOUT',
  CDP_ERROR: 'CDP_ERROR',
  CHROME_NOT_FOUND: 'CHROME_NOT_FOUND',
  CHROME_LAUNCH_FAILED: 'CHROME_LAUNCH_FAILED',
  PROXY_NOT_RUNNING: 'PROXY_NOT_RUNNING',
  PROXY_START_FAILED: 'PROXY_START_FAILED',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  DIALOG_NOT_FOUND: 'DIALOG_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FRAME_NOT_FOUND: 'FRAME_NOT_FOUND',
  NETWORK_REQUEST_NOT_FOUND: 'NETWORK_REQUEST_NOT_FOUND',
  JS_ERROR: 'JS_ERROR',
  INTERCEPT_ERROR: 'INTERCEPT_ERROR',
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---- Exit Codes ----

export const ExitCode = {
  SUCCESS: 0,
  USAGE_ERROR: 1,
  PROXY_ERROR: 2,
  CDP_ERROR: 3,
  URL_BLOCKED: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// ---- Console & Network Buffers ----

export interface ConsoleMessage {
  level: string;
  text: string;
  timestamp: number;
  source: string;
}

export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  size: number;
}

// ---- Dialog ----

export interface DialogInfo {
  type: string;
  message: string;
}

// ---- Intercept Rules ----

export interface InterceptRule {
  id: string;
  pattern: string;
  action: string;
  statusCode?: number;
  body?: string;
  headers?: Record<string, string>;
}

// ---- Emulation ----

export interface EmulationSettings {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  userAgent?: string;
  mediaType?: string;
  mediaFeatures?: Array<{ name: string; value: string }>;
}

// ---- App Profiles ----

export interface ActionStep {
  action: string;
  file?: string;
  selector?: string;
  keys?: string;
  value?: string;
  url?: string;
  direction?: string;
  amount?: number;
  duration?: number;
  timeout?: number;
  expression?: string;
  frame?: string;
  ref?: string;
  text?: string;
  filter?: string;
  [key: string]: unknown;
}

export interface ActionDef {
  description: string;
  params?: Record<string, string>;
  noScreenshot?: boolean;
  steps: ActionStep[];
}

export interface ObserverDef {
  description: string;
  condition: { selector: string };
  debounce?: number;
  run: string;
}

export interface ProfileManifest {
  name: string;
  description: string;
  match?: string[];
  selectors?: Record<string, string>;
  actions: Record<string, ActionDef>;
  observers?: Record<string, ObserverDef>;
}

export interface LoadedProfile {
  manifest: ProfileManifest;
  dir: string;
  source: 'repo' | 'user' | 'plugin';
}

// ---- GIF Recording ----

export interface GifFrame {
  data: Buffer;
  timestamp: number;
}
