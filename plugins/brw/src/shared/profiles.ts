import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ProfileManifest, LoadedProfile } from './types.js';

let profileCache: Map<string, LoadedProfile> | null = null;

// Walk up from startDir looking for .claude/brw/profiles/<name>/profile.json.
// Stops at filesystem root or home directory.
function findRepoProfiles(startDir: string): Map<string, LoadedProfile> {
  const profiles = new Map<string, LoadedProfile>();
  const home = homedir();
  let dir = startDir;

  while (true) {
    const profilesDir = join(dir, '.claude', 'brw', 'profiles');
    if (existsSync(profilesDir)) {
      try {
        const entries = readdirSync(profilesDir);
        for (const entry of entries) {
          const profileDir = join(profilesDir, entry);
          const manifestPath = join(profileDir, 'profile.json');
          if (statSync(profileDir).isDirectory() && existsSync(manifestPath)) {
            if (!profiles.has(entry)) {
              try {
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ProfileManifest;
                profiles.set(entry, { manifest, dir: profileDir, source: 'repo' });
              } catch {
                // Skip invalid manifests
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const parent = dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }

  return profiles;
}

/**
 * Scan user-level profiles at ~/.config/brw/profiles/
 */
function findUserProfiles(): Map<string, LoadedProfile> {
  const profiles = new Map<string, LoadedProfile>();
  const profilesDir = join(homedir(), '.config', 'brw', 'profiles');

  if (!existsSync(profilesDir)) return profiles;

  try {
    const entries = readdirSync(profilesDir);
    for (const entry of entries) {
      const profileDir = join(profilesDir, entry);
      const manifestPath = join(profileDir, 'profile.json');
      if (statSync(profileDir).isDirectory() && existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ProfileManifest;
          profiles.set(entry, { manifest, dir: profileDir, source: 'user' });
        } catch {
          // Skip invalid manifests
        }
      }
    }
  } catch {
    // ignore
  }

  return profiles;
}

/**
 * Discover all profiles from repo (walk-up), user, and plugin directories.
 * Higher priority shadows lower: repo > user > plugin.
 */
export function discoverProfiles(cwd?: string): Map<string, LoadedProfile> {
  const workDir = cwd || process.cwd();

  // Build merged map: lower priority first, higher overwrites
  const merged = new Map<string, LoadedProfile>();

  // User profiles (lower priority)
  const userProfiles = findUserProfiles();
  for (const [name, profile] of userProfiles) {
    merged.set(name, profile);
  }

  // Repo profiles (higher priority, overwrites user)
  const repoProfiles = findRepoProfiles(workDir);
  for (const [name, profile] of repoProfiles) {
    merged.set(name, profile);
  }

  profileCache = merged;
  return merged;
}

/**
 * Get a specific profile by name. Uses cache, re-discovers on miss.
 */
export function getProfile(name: string, cwd?: string): LoadedProfile | null {
  if (profileCache?.has(name)) {
    return profileCache.get(name)!;
  }

  // Re-discover and try again
  discoverProfiles(cwd);
  return profileCache?.get(name) || null;
}

/**
 * Read a JS file from a profile directory. Not cached — supports live editing.
 */
export function readProfileScript(profile: LoadedProfile, filename: string): string | null {
  const filepath = join(profile.dir, filename);
  if (!existsSync(filepath)) return null;
  try {
    return readFileSync(filepath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Clear the profile cache, forcing re-discovery on next access.
 */
export function clearProfileCache(): void {
  profileCache = null;
}

/**
 * Substitute $selectors.name and $paramName references in a string.
 * Selectors are resolved first to avoid conflicts with param names.
 */
export function substituteVars(
  value: string,
  params: Record<string, string>,
  selectors: Record<string, string>
): string {
  // Resolve $selectors.name first
  let result = value.replace(/\$selectors\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g, (match, name) => {
    return selectors[name] !== undefined ? selectors[name] : match;
  });

  // Resolve $paramName
  result = result.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name) => {
    return params[name] !== undefined ? params[name] : match;
  });

  return result;
}

/**
 * Deep-substitute all string values in an ActionStep.
 */
export function substituteStep(
  step: Record<string, unknown>,
  params: Record<string, string>,
  selectors: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (typeof value === 'string') {
      result[key] = substituteVars(value, params, selectors);
    } else {
      result[key] = value;
    }
  }
  return result;
}
