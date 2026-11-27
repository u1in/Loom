import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, loadConfig } from '../src/config';
import { build } from '../src/pipeline';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('configuration', () => {
  it('loads TypeScript, JavaScript, and asynchronous configs relative to their directory', async () => {
    for (const ext of ['ts', 'mts', 'js', 'mjs']) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
      roots.push(root);
      await writeFile(
        path.join(root, 'loom.config.' + ext),
        "export default async () => ({skills: [{name:'demo',source:'src'}]});",
      );
      const config = await loadConfig(root);
      expect(config.rootDir).toBe(root);
      expect(config.output).toBe('.');
    }
  });
  it('discovers and builds direct Skill source entries when skills is omitted', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    await writeFile(
      path.join(root, 'loom.config.mjs'),
      "export default {installDoc: {skills: ['alpha']}};",
    );
    for (const name of ['zeta', 'alpha']) {
      const source = path.join(root, 'src/skills', name);
      await mkdir(source, { recursive: true });
      await writeFile(
        path.join(source, 'SKILL.source.md'),
        '---\nname: ' + name + '\nmetadata:\n  version: 1.0.0\n---\n\n# Skill\n',
      );
    }
    for (const file of ['notes/README.md', 'legacy/SKILL.md', 'group/nested/SKILL.source.md']) {
      const location = path.join(root, 'src/skills', file);
      await mkdir(path.dirname(location), { recursive: true });
      await writeFile(location, 'Ignored');
    }
    const config = await loadConfig(root);
    expect(config.skills).toEqual([
      { name: 'alpha', source: 'src/skills/alpha', entry: 'SKILL.source.md' },
      { name: 'zeta', source: 'src/skills/zeta', entry: 'SKILL.source.md' },
    ]);
    await build(config, { skill: 'alpha' });
    await expect(readFile(path.join(root, 'skills/alpha/SKILL.md'), 'utf8')).resolves.toContain(
      'name: alpha',
    );
    await expect(readFile(path.join(root, 'skills/alpha/SKILL.source.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(path.join(root, 'skills/zeta/SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('reports missing conventional sources and validates scopes after discovery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    await writeFile(
      path.join(root, 'loom.config.mjs'),
      "export default {installDoc: {skills: ['missing']}};",
    );
    await expect(loadConfig(root)).rejects.toThrow('Expected src/skills/<name>/SKILL.source.md');
    const source = path.join(root, 'src/skills/demo');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'SKILL.source.md'), '# Skill');
    await expect(loadConfig(root)).rejects.toThrow('Unknown skill: missing');
  });
  it('builds skillsPath matches using each entry name and source directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    const skillsPath = 'packages/{first,second}/src/SKILL.source.md';
    await writeFile(
      path.join(root, 'loom.config.mjs'),
      'export default ' + JSON.stringify({ skillsPath, installDoc: { skills: ['review'] } }),
    );
    for (const [directory, name] of [
      ['second', 'release'],
      ['ignored', 'ignored'],
      ['first', 'review'],
    ] as const) {
      const source = path.join(root, 'packages', directory, 'src');
      await mkdir(source, { recursive: true });
      await writeFile(
        path.join(source, 'SKILL.source.md'),
        '---\r\nname: ' + name + '\r\nmetadata:\r\n  version: 1.0.0\r\n---\r\n\r\n# Skill\r\n',
      );
      await writeFile(path.join(source, 'asset.txt'), name);
    }

    const config = await loadConfig(root);
    expect(config.skills).toEqual([
      { name: 'review', source: 'packages/first/src', entry: 'SKILL.source.md' },
      { name: 'release', source: 'packages/second/src', entry: 'SKILL.source.md' },
    ]);
    await build(config, { skill: 'review' });
    await expect(readFile(path.join(root, 'skills/review/asset.txt'), 'utf8')).resolves.toBe(
      'review',
    );
    await expect(readFile(path.join(root, 'skills/review/SKILL.md'), 'utf8')).resolves.toContain(
      'name: review',
    );
  });
  it('reports unmatched globs, invalid matches, and conflicting discovery settings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    const skillsPath = 'packages/*/src/SKILL.source.md';
    await writeFile(
      path.join(root, 'loom.config.mjs'),
      'export default ' + JSON.stringify({ skillsPath }),
    );
    await expect(loadConfig(root)).rejects.toThrow('No skills found for skillsPath: ' + skillsPath);
    const source = path.join(root, 'packages/demo/src');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'SKILL.source.md'), '---\nname: 42\n---\n\n# Skill\n');
    await expect(loadConfig(root)).rejects.toThrow(
      'packages/demo/src/SKILL.source.md: invalid or missing frontmatter name',
    );
    expect(() => defineConfig({ skillsPath, skills: [{ name: 'demo', source: 'demo' }] })).toThrow(
      'skills and skillsPath are mutually exclusive',
    );
  });
  it('accepts safe custom entries and rejects paths outside the skill', () => {
    expect(
      defineConfig({
        skills: [{ name: 'demo', source: 'src', entry: 'SKILL.source.md' }],
      }),
    ).toMatchObject({ skills: [{ entry: 'SKILL.source.md' }] });
    expect(() =>
      defineConfig({ skills: [{ name: 'demo', source: 'src', entry: '../SKILL.md' }] }),
    ).toThrow();
  });
  it('validates baseUrl as an HTTP URL without a query or fragment', () => {
    const skills = [{ name: 'demo', source: 'src' }];
    expect(defineConfig({ skills, baseUrl: 'https://example.com/skills/{{name}}/' })).toMatchObject(
      { baseUrl: 'https://example.com/skills/{{name}}/' },
    );
    for (const baseUrl of [
      'relative/path',
      'file:///tmp/',
      'https://example.com/?q=1',
      'https://example.com/#part',
    ]) {
      expect(() => defineConfig({ skills, baseUrl })).toThrow();
    }
  });
  it('reloads mjs configuration for determinism checks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    await writeFile(
      path.join(root, 'loom.config.mjs'),
      "export default {skills: [{name:'demo',source:'src'}], variables: {VALUE: String(Math.random())}};",
    );
    const first = await loadConfig(root);
    const second = await loadConfig(root);
    expect(first.variables?.VALUE).not.toBe(second.variables?.VALUE);
  });
  it('reports invalid files and plugin shapes with useful context', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    await expect(loadConfig(root)).rejects.toThrow('No loom.config');
    await writeFile(path.join(root, 'loom.config.ts'), 'export default {version: 1};');
    await expect(loadConfig(root)).rejects.toThrow(
      /Failed to load config[\s\S]*Unrecognized key.*version/,
    );
    expect(() =>
      defineConfig({
        skills: [
          { name: 'demo', source: 'src' },
          { name: 'demo', source: 'src' },
        ],
      }),
    ).toThrow('unique');
  });
});
