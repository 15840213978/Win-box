import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Keep private artwork out of Git, but use it automatically on the release machine. */
export function resolvePrivateImage(
  root: string,
  candidates: string[],
  placeholder: string,
  override?: string,
  release = false,
  label = 'private artwork',
): string {
  const image = override
    ? resolve(root, override)
    : candidates.map(file => resolve(root, file)).find(existsSync) || resolve(root, placeholder);
  if (!existsSync(image)) throw new Error(`${label} does not exist: ${image}`);
  if (release) {
    const bytes = readFileSync(image);
    const isPng = bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && bytes.readUInt32BE(16) > 1 && bytes.readUInt32BE(20) > 1;
    const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (!isPng && !isJpeg) {
      throw new Error(`Release requires the original ${label} image; the source placeholder must not be packaged.`);
    }
  }
  return image;
}

export function resolveSupportImage(root: string, override?: string, release = false): string {
  return resolvePrivateImage(
    root,
    ['src/renderer/assets/author-support.png', '.tmp/private-assets/author-support.png'],
    'src/renderer/assets/author-support-placeholder.svg',
    override,
    release,
    'support PNG',
  );
}

export function resolveGroupImage(root: string, override?: string, release = false): string {
  return resolvePrivateImage(
    root,
    ['src/renderer/assets/group-join.jpg', '.tmp/private-assets/group-join.jpg', 'src/renderer/assets/group-join.png', '.tmp/private-assets/group-join.png'],
    'src/renderer/assets/group-join-placeholder.svg',
    override,
    release,
    'group QR artwork',
  );
}
