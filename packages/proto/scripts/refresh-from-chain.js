import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const chainRepoPath = resolve(process.env.CHAIN_REPO_PATH ?? '/Users/quasar/Github/nyks-core');
const sourceDir = join(chainRepoPath, 'docs', 'proto');
const targetDir = join(packageRoot, 'descriptors');

const artifacts = [
  'twilight-descriptors.pb',
  'twilight-msg-type-urls.json',
  'README.md',
];

mkdirSync(targetDir, { recursive: true });

for (const artifact of artifacts) {
  const source = join(sourceDir, artifact);
  const target = join(targetDir, artifact);
  if (!existsSync(source)) {
    throw new Error(`Missing proto artifact: ${source}`);
  }
  copyFileSync(source, target);
  const bytes = readFileSync(target);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const size = statSync(target).size;
  console.log(`${artifact} ${size} bytes sha256=${checksum}`);
}
