import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, chmodSync, statSync, readFileSync } from "fs";
import { join, dirname } from "path";
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
 * Whether creds.json represents a COMPLETED pairing (registered === true), vs
 * half-written pairing leftovers (a `requestPairingCode` call writes creds.json
 * with `me`/`pairingCode` but `registered: false`). Lets the pairing flow clear
 * useless leftovers instead of backing them up on every retry.
 */
export function credsAreRegistered(authDir: string): boolean {
  try {
    const p = join(authDir, "creds.json");
    if (!existsSync(p)) return false;
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    return parsed?.registered === true;
  } catch {
    return false;
  }
}

/**
 * Back up the auth directory by renaming it to `${authDir}.bak.${unixMillis}`.
 * Used before a destructive wipe so a spurious 401 (loggedOut) does not
 * force a full QR re-pair -- the operator can recover by renaming the
 * backup back into place.
 *
 * Returns the backup path on success, or null if authDir is missing/empty.
 */
export async function backupCredentials(authDir: string): Promise<string | null> {
  const logger = getGlobalLogger();

  try {
    if (!existsSync(authDir)) {
      logger.info("No auth directory to back up", { authDir });
      return null;
    }

    let files: string[] = [];
    try {
      files = readdirSync(authDir);
    } catch {
      files = [];
    }
    if (files.length === 0) {
      logger.info("Auth directory empty, skipping backup", { authDir });
      return null;
    }

    const backupPath = `${authDir}.bak.${Date.now()}`;
    renameSync(authDir, backupPath);

    logger.warn("Auth credentials backed up", {
      authDir,
      backupPath,
      filesPreserved: files.length,
    });
    audit("auth_credentials_backed_up", { authDir, backupPath, filesPreserved: files.length });

    return backupPath;
  } catch (err: any) {
    logger.error("Failed to back up auth credentials", { authDir, error: err?.message });
    throw err;
  }
}

/**
 * List credential backups produced by backupCredentials(), newest first.
 * A backup is any sibling directory named `${authDir}.bak.<unixMillis>`.
 */
export function listCredentialBackups(authDir: string): Array<{ path: string; ts: number }> {
  try {
    const dir = dirname(authDir);
    const base = authDir.slice(dir.length + 1); // basename of authDir
    const prefix = `${base}.bak.`;
    const entries = readdirSync(dir);
    const backups: Array<{ path: string; ts: number }> = [];
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue;
      const tsPart = name.slice(prefix.length);
      const ts = parseInt(tsPart, 10);
      if (isNaN(ts)) continue;
      const full = join(dir, name);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      backups.push({ path: full, ts });
    }
    return backups.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/**
 * Restore the most recent credential backup back into authDir.
 *
 * Self-heals a spurious deauth (P1-#4): backupCredentials() renamed the live
 * auth dir aside, so `hasCredentials` reads false and the operator would
 * otherwise need a fresh QR/pairing. This renames the newest backup back into
 * place — but only when the live dir is absent or empty, so we never clobber
 * good credentials.
 *
 * Returns the restored backup path, or null if there was nothing to restore.
 * Throws only on an unexpected filesystem error mid-rename.
 */
export async function restoreCredentials(authDir: string): Promise<string | null> {
  const logger = getGlobalLogger();

  // Refuse if live creds are already present — restoring would clobber them.
  if (hasCredentials(authDir)) {
    logger.info("Live credentials present, refusing to restore over them", { authDir });
    return null;
  }

  const backups = listCredentialBackups(authDir);
  if (backups.length === 0) {
    logger.info("No credential backups to restore", { authDir });
    return null;
  }

  const newest = backups[0];

  // Clear an empty/partial live dir so the rename target is free.
  try {
    if (existsSync(authDir)) {
      const files = readdirSync(authDir);
      if (files.length > 0) {
        logger.warn("Auth dir non-empty but lacks creds.json — clearing before restore", {
          authDir,
          files: files.length,
        });
      }
      for (const f of files) {
        try {
          unlinkSync(join(authDir, f));
        } catch {
          /* ignore */
        }
      }
      renameSync(authDir, `${authDir}.stale.${Date.now()}`);
    }
  } catch {
    /* best effort — proceed to rename backup in */
  }

  renameSync(newest.path, authDir);
  enforceAuthPermissions(authDir);

  logger.warn("Restored auth credentials from backup", {
    authDir,
    restoredFrom: newest.path,
  });
  audit("auth_credentials_restored", { authDir, restoredFrom: newest.path });

  return newest.path;
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
