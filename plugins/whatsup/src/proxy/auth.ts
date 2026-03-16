import { existsSync, mkdirSync, readdirSync, unlinkSync, chmodSync, statSync } from "fs";
import { join } from "path";
import { useMultiFileAuthState } from "baileys";
import QRCode from "qrcode";
import type { WhatsUpConfig } from "../shared/types.js";
import { getGlobalLogger, audit } from "./logger.js";

// ---- Types ----

export interface AuthState {
  state: Awaited<ReturnType<typeof useMultiFileAuthState>>["state"];
  saveCreds: () => Promise<void>;
}

// ---- Auth State Initialization ----

/**
 * Initialize auth state from persistent directory.
 * Creates authDir with 0700 perms if it does not exist.
 * Individual auth files are written by Baileys with default perms;
 * we enforce 0600 on them after initialization.
 */
export async function initAuthState(config: WhatsUpConfig): Promise<AuthState> {
  const logger = getGlobalLogger();
  const { authDir } = config;

  // Ensure authDir exists with restrictive permissions
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    logger.info("Created auth directory", { authDir });
  } else {
    // Enforce directory permissions on existing dir
    try {
      chmodSync(authDir, 0o700);
    } catch {
      logger.warn("Could not enforce permissions on auth directory", { authDir });
    }
  }

  audit("auth_init", { authDir });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Enforce file permissions on any existing auth files
  enforceAuthPermissions(authDir);

  return { state, saveCreds };
}

// ---- QR Code Handling ----

/**
 * Generate QR code PNG and save to file.
 * File is written with 0600 permissions.
 * This file should be deleted after successful auth via cleanupQrCode().
 */
export async function saveQrCode(qr: string, filePath: string): Promise<void> {
  const logger = getGlobalLogger();

  await QRCode.toFile(filePath, qr, {
    type: "png",
    width: 300,
    margin: 2,
  });

  // Restrict file permissions to owner-only
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort -- may fail on some platforms
  }

  logger.info("QR code saved", { filePath });
  audit("qr_generated", { filePath });
}

/**
 * Delete QR code file after successful auth.
 * Silently ignores errors if file does not exist.
 */
export function cleanupQrCode(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      getGlobalLogger().info("QR code file cleaned up", { filePath });
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ---- Credential Checks ----

/**
 * Check if auth credentials exist without loading full state.
 * Looks for creds.json in the auth directory.
 */
export function hasCredentials(authDir: string): boolean {
  try {
    return existsSync(join(authDir, "creds.json"));
  } catch {
    return false;
  }
}

/**
 * Clear all auth credentials (for logout).
 * Removes all files in the auth directory.
 */
export async function clearCredentials(authDir: string): Promise<void> {
  const logger = getGlobalLogger();

  try {
    if (!existsSync(authDir)) return;

    const files = readdirSync(authDir);
    for (const file of files) {
      try {
        unlinkSync(join(authDir, file));
      } catch {
        // Ignore individual file deletion errors
      }
    }

    logger.info("Auth credentials cleared", { authDir, filesRemoved: files.length });
    audit("auth_credentials_cleared", { authDir });
  } catch (err: any) {
    logger.error("Failed to clear auth credentials", { authDir, error: err?.message });
    throw err;
  }
}

// ---- Permission Enforcement ----

/**
 * Ensure proper file permissions on auth directory and its files.
 * Directory: 0700 (owner rwx only)
 * Files: 0600 (owner rw only)
 */
export function enforceAuthPermissions(authDir: string): void {
  try {
    if (!existsSync(authDir)) return;

    // Enforce directory permissions
    chmodSync(authDir, 0o700);

    // Enforce file permissions on all files in the directory
    const files = readdirSync(authDir);
    for (const file of files) {
      const filePath = join(authDir, file);
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) {
          chmodSync(filePath, 0o600);
        }
      } catch {
        // Skip files we cannot chmod
      }
    }
  } catch {
    // Best effort -- permission enforcement is defensive
  }
}
