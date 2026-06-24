import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TWILIGHT_DESCRIPTOR_PATH = join(
  packageRoot,
  'descriptors',
  'twilight-descriptors.pb',
);

export const TWILIGHT_MSG_TYPE_URLS_PATH = join(
  packageRoot,
  'descriptors',
  'twilight-msg-type-urls.json',
);

export function loadTwilightMsgTypeUrls(): unknown {
  return JSON.parse(readFileSync(TWILIGHT_MSG_TYPE_URLS_PATH, 'utf8'));
}

export function getDescriptorBytes(): Uint8Array {
  return readFileSync(TWILIGHT_DESCRIPTOR_PATH);
}
