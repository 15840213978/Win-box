import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Keep private artwork out of Git, but use it automatically on the release machine. */
export function resolveSupportImage(root: string, override?: string, release = false): string {
  const candidates = ['src/renderer/assets/author-support.png', '.tmp/private-assets/author-support.png'];
  const image = override
    ? resolve(root, override)
    : candidates.map(file => resolve(root, file)).find(existsSync)
      || resolve(root, 'src/renderer/assets/author-support-placeholder.svg');
  if (!existsSync(image)) throw new Error(`Support artwork does not exist: ${image}`);
  if (release) {
    const bytes = readFileSync(image);
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.readUInt32BE(16) <= 1 || bytes.readUInt32BE(20) <= 1) {
      throw new Error('Release requires the original support PNG; the source placeholder must not be packaged.');
    }
  }
  return image;
}
