// Generates latest.json for the Tauri updater, signs the installer, and uploads
// both to a GitHub Release for the current version's tag.
//
// Prereqs:
//   - TAURI_SIGNING_PRIVATE_KEY env var (or .tauri/mdpeek.key present)
//   - gh CLI authed (gh auth status)
//   - the installer already built: releases/mdpeek-<version>-setup.exe
//
// Usage:
//   npm run make-release
//
// Result:
//   - releases/mdpeek-<version>-setup.exe.sig      (signature)
//   - releases/latest.json                          (updater manifest)
//   - GitHub Release v<version> updated with setup.exe + latest.json as assets
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const repo = 'sanketpatel32/Mdpeek';

const setupExe = join(root, 'releases', `mdpeek-${version}-setup.exe`);
if (!existsSync(setupExe)) {
  console.error(`[make-release] Missing ${setupExe}. Run 'npm run tauri:build' first.`);
  process.exit(1);
}

// 1. Sign the installer with the Tauri signer.
//    Note: invoke via shell + cwd=root so we can pass a relative path. The
//    project path contains a space ("Fun projects"), which breaks the signer's
//    arg parser when passed as an absolute unquoted path through a shell.
console.log(`[make-release] Signing ${setupExe}...`);
const signEnv = {
  ...process.env,
  // Prefer the key file on disk if env var isn't set.
  TAURI_SIGNING_PRIVATE_KEY_PATH:
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || join(root, '.tauri', 'mdpeek.key'),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '',
};
const sign = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tauri', 'signer', 'sign', `releases/mdpeek-${version}-setup.exe`, '-v'],
  { env: signEnv, stdio: 'inherit', cwd: root, shell: true },
);
if (sign.status !== 0) {
  console.error('[make-release] Signing failed.');
  process.exit(sign.status || 1);
}

// 2. Read the generated .sig
const sigPath = `${setupExe}.sig`;
if (!existsSync(sigPath)) {
  console.error(`[make-release] Signature not found at ${sigPath}`);
  process.exit(1);
}
const signature = readFileSync(sigPath, 'utf8').trim();

// 3. Build latest.json — the manifest the updater fetches.
const setupName = `mdpeek-${version}-setup.exe`;
const url = `https://github.com/${repo}/releases/download/v${version}/${setupName}`;
const latest = {
  version: `${version}`,
  notes: `mdpeek v${version}. See CHANGELOG.md for details.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url,
    },
  },
};

import('node:fs/promises').then(async ({ writeFile }) => {
  const latestPath = join(root, 'releases', 'latest.json');
  await writeFile(latestPath, JSON.stringify(latest, null, 2));
  console.log(`[make-release] Wrote ${latestPath}`);

  // 4. Upload assets to the GitHub Release for v<version>.
  console.log(`[make-release] Uploading assets to GitHub Release v${version}...`);
  const upload = (absPath) => {
    // gh is invoked via shell with cwd=root, so pass a relative path
    // (the project path has a space which would break unquoted args).
    const relPath = absPath.replace(root + '\\', '').replace(root + '/', '');
    const r = spawnSync(
      'gh',
      ['release', 'upload', `v${version}`, relPath, '--clobber'],
      { stdio: 'inherit', cwd: root, shell: true },
    );
    if (r.status !== 0) {
      console.error(`[make-release] Upload failed for ${relPath}`);
      process.exit(r.status || 1);
    }
  };
  upload(setupExe);
  upload(latestPath);
  console.log(`[make-release] Done. Release v${version} updated.`);
});
