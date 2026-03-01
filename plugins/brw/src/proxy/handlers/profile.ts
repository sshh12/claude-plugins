import type { ApiResponse } from '../../shared/types.js';
import { discoverProfiles, getProfile } from '../../shared/profiles.js';

export async function handleProfileList(params: {
  cwd?: string;
}): Promise<ApiResponse> {
  const profiles = discoverProfiles(params.cwd);

  const list = Array.from(profiles.entries()).map(([name, p]) => ({
    name,
    description: p.manifest.description,
    match: p.manifest.match || [],
    actions: Object.keys(p.manifest.actions),
    selectors: Object.keys(p.manifest.selectors || {}),
    source: p.source,
  }));

  return { ok: true, profiles: list };
}

export async function handleProfileShow(params: {
  name: string;
  cwd?: string;
}): Promise<ApiResponse> {
  if (!params.name) {
    return { ok: false, error: 'Profile name required', code: 'INVALID_ARGUMENT' };
  }

  const profile = getProfile(params.name, params.cwd);
  if (!profile) {
    return {
      ok: false,
      error: `Profile "${params.name}" not found`,
      code: 'PROFILE_NOT_FOUND',
      hint: 'Use "brw profile list" to see available profiles.',
    };
  }

  const actions: Record<string, { description: string; params?: Record<string, string>; noScreenshot?: boolean; steps: number }> = {};
  for (const [actionName, actionDef] of Object.entries(profile.manifest.actions)) {
    actions[actionName] = {
      description: actionDef.description,
      params: actionDef.params,
      noScreenshot: actionDef.noScreenshot,
      steps: actionDef.steps.length,
    };
  }

  return {
    ok: true,
    name: profile.manifest.name,
    description: profile.manifest.description,
    match: profile.manifest.match || [],
    selectors: profile.manifest.selectors || {},
    actions,
    observers: profile.manifest.observers || {},
    source: profile.source,
    dir: profile.dir,
  };
}
