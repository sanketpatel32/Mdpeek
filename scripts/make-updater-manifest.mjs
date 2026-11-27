import { readFileSync, writeFileSync } from 'node:fs';

const [version, signaturePath, installerName, outputPath] = process.argv.slice(2);

if (!version || !signaturePath || !installerName || !outputPath) {
  console.error('Usage: node scripts/make-updater-manifest.mjs <version> <signature-path> <installer-name> <output-path>');
  process.exit(1);
}

const signature = readFileSync(signaturePath, 'utf8').trim();
if (!signature) {
  console.error(`Empty updater signature: ${signaturePath}`);
  process.exit(1);
}

const manifest = {
  version,
  notes: `mdpeek v${version}. See CHANGELOG.md for details.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/sanketpatel32/Mdpeek/releases/download/v${version}/${installerName}`,
    },
  },
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
