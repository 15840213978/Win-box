import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveGroupImage, resolveSupportImage } from '../src/build/supportImage';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'support-image-'));
  dirs.push(root);
  const placeholder = join(root, 'src/renderer/assets/author-support-placeholder.svg');
  mkdirSync(dirname(placeholder), { recursive: true });
  writeFileSync(placeholder, '<svg/>');
  const original = join(root, '.tmp/private-assets/author-support.png');
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(1001, 16); png.writeUInt32BE(1001, 20);
  return { root, original, placeholder, png };
}
describe('support artwork build selection', () => {
  it('keeps a clean source checkout buildable with its placeholder', () => {
    const { root, placeholder } = fixture();
    expect(resolveSupportImage(root)).toBe(placeholder);
  });
  it('automatically uses local private artwork without an environment override', () => {
    const { root, original, png } = fixture();
    mkdirSync(dirname(original), { recursive: true }); writeFileSync(original, png);
    expect(resolveSupportImage(root)).toBe(original);
    expect(resolveSupportImage(root, undefined, true)).toBe(original);
  });
  it('refuses to release a placeholder or a missing explicit image', () => {
    const { root, placeholder } = fixture();
    expect(() => resolveSupportImage(root, undefined, true)).toThrow('original support PNG');
    expect(() => resolveSupportImage(root, placeholder, true)).toThrow('original support PNG');
    expect(() => resolveSupportImage(root, 'missing.png')).toThrow('does not exist');
  });

  it('selects and validates the private group QR image', () => {
    const { root, png } = fixture();
    const placeholder = join(root, 'src/renderer/assets/group-join-placeholder.svg');
    mkdirSync(dirname(placeholder), { recursive: true });
    writeFileSync(placeholder, '<svg/>');
    const original = join(root, '.tmp/private-assets/group-join.jpg');
    mkdirSync(dirname(original), { recursive: true });
    const jpg = Buffer.from([0xff, 0xd8, ...png, 0xff, 0xd9]);
    writeFileSync(original, jpg);
    expect(resolveGroupImage(root)).toBe(original);
    expect(resolveGroupImage(root, undefined, true)).toBe(original);
    expect(() => resolveGroupImage(root, placeholder, true)).toThrow('original group QR artwork');
  });
});
