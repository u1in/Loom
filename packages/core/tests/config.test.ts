import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, loadConfig } from '../src/config';
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
        "export default async () => ({version: 1, skills: [{name:'demo',source:'src'}]});",
      );
      const config = await loadConfig(root);
      expect(config.rootDir).toBe(root);
      expect(config.output).toBe('.');
    }
  });
  it('accepts safe custom entries and rejects paths outside the skill', () => {
    expect(
      defineConfig({
        version: 1,
        skills: [{ name: 'demo', source: 'src', entry: 'SKILL.source.md' }],
      }),
    ).toMatchObject({ skills: [{ entry: 'SKILL.source.md' }] });
    expect(() =>
      defineConfig({ version: 1, skills: [{ name: 'demo', source: 'src', entry: '../SKILL.md' }] }),
    ).toThrow();
  });
  it('validates baseUrl as an HTTP URL without a query or fragment', () => {
    const skills = [{ name: 'demo', source: 'src' }];
    expect(
      defineConfig({ version: 1, skills, baseUrl: 'https://example.com/skills/{{name}}/' }),
    ).toMatchObject({ baseUrl: 'https://example.com/skills/{{name}}/' });
    for (const baseUrl of [
      'relative/path',
      'file:///tmp/',
      'https://example.com/?q=1',
      'https://example.com/#part',
    ]) {
      expect(() => defineConfig({ version: 1, skills, baseUrl })).toThrow();
    }
  });
  it('reloads mjs configuration for determinism checks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    await writeFile(
      path.join(root, 'loom.config.mjs'),
      "export default {version: 1, skills: [{name:'demo',source:'src'}], variables: {VALUE: String(Math.random())}};",
    );
    const first = await loadConfig(root);
    const second = await loadConfig(root);
    expect(first.variables?.VALUE).not.toBe(second.variables?.VALUE);
  });
  it('reports invalid files and plugin shapes with useful context', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'loom-config-'));
    roots.push(root);
    await expect(loadConfig(root)).rejects.toThrow('No loom.config');
    await writeFile(path.join(root, 'loom.config.ts'), 'export default {version: 2};');
    await expect(loadConfig(root)).rejects.toThrow('Failed to load config');
    expect(() =>
      defineConfig({
        version: 1,
        skills: [
          { name: 'demo', source: 'src' },
          { name: 'demo', source: 'src' },
        ],
      }),
    ).toThrow('unique');
  });
});
