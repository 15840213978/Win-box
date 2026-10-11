// Release-only build: refuse to package source placeholder artwork.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = process.env.WINBOX_SUPPORT_IMAGE
  ? resolve(root, process.env.WINBOX_SUPPORT_IMAGE)
  : ['src/renderer/assets/author-support.png', '.tmp/private-assets/author-support.png']
    .map(file => join(root, file)).find(existsSync);
if (!image) throw new Error('Private support PNG missing. Set WINBOX_SUPPORT_IMAGE to the original artwork before releasing.');
const groupImage = process.env.WINBOX_GROUP_IMAGE
  ? resolve(root, process.env.WINBOX_GROUP_IMAGE)
  : ['src/renderer/assets/group-join.jpg', '.tmp/private-assets/group-join.jpg', 'src/renderer/assets/group-join.png', '.tmp/private-assets/group-join.png']
    .map(file => join(root, file)).find(existsSync);
if (!groupImage) throw new Error('Private group QR image missing. Set WINBOX_GROUP_IMAGE to the original artwork before releasing.');
const env = { ...process.env, WINBOX_SUPPORT_IMAGE: image, WINBOX_GROUP_IMAGE: groupImage, WINBOX_RELEASE_BUILD: '1' };
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(['scripts/build-main.mjs']);
run(['node_modules/vite/bin/vite.js', 'build']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = hash(readFileSync(image));
const groupOriginal = hash(readFileSync(groupImage));
const assets = join(root, 'dist/renderer/assets');
const packagedImage = readdirSync(assets).find(name => /\.(png|jpe?g)$/i.test(name) && hash(readFileSync(join(assets, name))) === original);
if (!packagedImage) throw new Error('Built renderer does not contain the original support image. Packaging stopped.');
const packagedGroupImage = readdirSync(assets).find(name => /\.(png|jpe?g)$/i.test(name) && hash(readFileSync(join(assets, name))) === groupOriginal);
if (!packagedGroupImage) throw new Error('Built renderer does not contain the original group QR image. Packaging stopped.');
console.log(`Support artwork verified: ${packagedImage} / SHA256 ${original}`);
console.log(`Group QR artwork verified: ${packagedGroupImage} / SHA256 ${groupOriginal}`);
run(['node_modules/electron-builder/out/cli/cli.js', '--win', 'nsis', '--publish', 'never']);
