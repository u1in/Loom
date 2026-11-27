import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, hashFiles } from '@u1in/loom-core';
import envProbe from '../src/index';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('keeps print output unchanged and writes environment only when configured', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loom-probe-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(
    path.join(root, 'src/SKILL.md'),
    '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n# Demo\n',
  );
  const base = {
    version: 1 as const,
    rootDir: root,
    output: 'dist',
    skills: [{ name: 'demo', source: 'src' }],
  };
  await build(base);
  const normal = await hashFiles(path.join(root, 'dist'));
  await build({ ...base, plugins: [envProbe({ mode: 'print', probe: { platform: true } })] });
  expect(await hashFiles(path.join(root, 'dist'))).toEqual(normal);
  await build({ ...base, plugins: [envProbe({ mode: 'metadata', probe: { platform: true } })] });
  expect(await readFile(path.join(root, 'dist/skills/demo/SKILL.md'), 'utf8')).toContain(
    'platform: ' + process.platform,
  );
  await build({ ...base, plugins: [envProbe({ mode: 'file', probe: { nodeVersion: true } })] });
  expect(
    JSON.parse(await readFile(path.join(root, 'dist/skills/demo/.loom-env.json'), 'utf8'))
      .nodeVersion,
  ).toBe(process.version);
});
