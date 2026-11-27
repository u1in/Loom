import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from '@u1in/loom-core';
import preflight from '../src/index';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('generates per-skill preflight content, metadata, and interpolated scripts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loom-preflight-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(
    path.join(root, 'src/SKILL.md'),
    '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n# Demo\n',
  );
  await writeFile(path.join(root, 'template.js'), '// {{name}} {{version}} {{PROJECT}}\n');
  await build({
    version: 1,
    rootDir: root,
    output: 'dist',
    skills: [{ name: 'demo', source: 'src' }],
    variables: { PROJECT: 'Loom' },
    plugins: [
      preflight({
        tools: [{ name: 'git' }],
        perSkill: { demo: { tools: [{ name: 'node', required: true }] } },
        checks: [{ file: 'scripts/check.js', template: 'template.js' }],
      }),
    ],
  });
  const md = await readFile(path.join(root, 'dist/skills/demo/SKILL.md'), 'utf8');
  expect(md).toContain('使用前检查');
  expect(md).toContain('node');
  expect(md).not.toContain('loom:preflight:');
  expect(md).not.toContain('git');
  expect(await readFile(path.join(root, 'dist/skills/demo/scripts/check.js'), 'utf8')).toBe(
    '// demo 1.0.0 Loom\n',
  );
});
it('validates plugin options', () => {
  expect(() => preflight({ tools: [{ name: 3 as unknown as string }] })).toThrow();
});
