// Copies the built installer + portable binary into a clean top-level releases/
// folder, versioned by package.json. Run automatically after `tauri build`.
//
// Result:
//   releases/mdpeek-<version>-setup.exe     (NSIS GUI installer)
//   releases/mdpeek-<version>-portable.exe  (standalone, no install)
//
// Usage: node scripts/copy-release.js
import { mkdirSync, copyFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(
  await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8'),
);
const version = pkg.version;

const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const binPath = join(root, 'src-tauri', 'target', 'release', 'mdpeek.exe');
const releasesDir = join(root, 'releases');

mkdirSync(releasesDir, { recursive: true });

// Find the NSIS installer for THIS version. The nsis dir accumulates old
// installers across builds, so match the exact version to avoid picking a
// stale one (e.g. mdpeek_0.0.1_x64-setup.exe when building 0.0.3).
let installer = null;
if (existsSync(nsisDir)) {
  const setupRe = new RegExp(`^mdpeek_${escapeRegex(version)}.*-setup\\.exe$`, 'i');
  installer = readdirSync(nsisDir).find((f) => setupRe.test(f));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const copied = [];
if (installer) {
  const dest = join(releasesDir, `mdpeek-${version}-setup.exe`);
  copyFileSync(join(nsisDir, installer), dest);
  copied.push({ dest, size: statSync(dest).size });
} else {
  console.warn('[copy-release] No NSIS installer found in', nsisDir);
}

if (existsSync(binPath)) {
  const dest = join(releasesDir, `mdpeek-${version}-portable.exe`);
  copyFileSync(binPath, dest);
  copied.push({ dest, size: statSync(dest).size });
} else {
  console.warn('[copy-release] No portable binary found at', binPath);
}

if (copied.length === 0) {
  console.error('[copy-release] Nothing to copy — did the build succeed?');
  process.exit(1);
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log('\n📦 Release artifacts copied to releases/:');
for (const { dest, size } of copied) {
  const rel = dest.replace(root + '\\', '').replace(root + '/', '');
  console.log(`   ${rel}  (${mb(size)} MB)`);
}
