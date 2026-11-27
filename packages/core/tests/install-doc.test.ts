import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, hashFiles } from '../src/pipeline';
import { installDoc } from '@u1in/loom-plugin-install-doc';
import type { LoadedConfig } from '../src/types';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const skillSource =
  '---\nname: demo\ndescription: 演示用 Skill\nmetadata:\n  version: 1.0.0\n---\n\n# Demo\n';

const fixture = async (installDoc?: LoadedConfig['installDoc']) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loom-install-'));
  dirs.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'SKILL.md'), skillSource);
  const config: LoadedConfig = {
    rootDir: root,
    output: 'dist',
    skills: [{ name: 'demo', source: 'src' }],
    baseUrl: 'https://gitlab.example.com/group/repo/-/raw/main/skills/{{name}}/',
    installDoc,
  };
  return { root, config };
};

describe('installDoc build', () => {
  it('emits INSTALL.md by default with the interpolated publishing address', async () => {
    const { root, config } = await fixture();
    config.baseUrl = 'https://gitlab.example.com/group/repo/-/raw/{{REF}}/skills/{{name}}/';
    config.variables = { REF: 'skills-release' };
    await build(config);
    const doc = await readFile(path.join(root, 'dist/skills/demo/INSTALL.md'), 'utf8');
    const url = 'https://gitlab.example.com/group/repo/-/tree/skills-release/skills/demo';
    expect(doc).toBe(
      '请使用 `skills` CLI，从 [' + url + '](' + url + ') 将 `demo` 安装到当前 harness。\n',
    );
    await build(config, { check: true });
    const first = await hashFiles(path.join(root, 'dist'));
    await build(config);
    expect(await hashFiles(path.join(root, 'dist'))).toEqual(first);
  });

  it('omits the generated document after disabling installDoc', async () => {
    const { root, config } = await fixture();
    const file = path.join(root, 'dist/skills/demo/INSTALL.md');
    await build(config);
    await expect(readFile(file, 'utf8')).resolves.toContain('安装到当前 harness');
    config.installDoc = false;
    await build(config);
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await build(config, { check: true });
  });

  it.each([undefined, true, false])(
    'uses the explicit installDoc plugin in place of automatic registration (%s)',
    async (automatic) => {
      const { root, config } = await fixture(automatic);
      config.plugins = [
        {
          name: 'test-description',
          apply: (api) => {
            api.addMetadataTransform((frontmatter) => ({ ...frontmatter, description: 'Updated' }));
          },
        },
        installDoc({
          file: 'SETUP.md',
          source: 'https://example.com/{{name}}',
          text: '{{description}} {{source}}\n',
        }),
      ];
      await build(config);
      const output = path.join(root, 'dist/skills/demo');
      await expect(readFile(path.join(output, 'SETUP.md'), 'utf8')).resolves.toBe(
        'Updated https://example.com/demo\n',
      );
      await expect(readFile(path.join(output, 'INSTALL.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await build(config, { check: true });
    },
  );

  it('applies a template with variables and skill scoping', async () => {
    const { root, config } = await fixture({
      template: 'partials/install.md',
      skills: ['demo'],
      file: 'SETUP.md',
      source: 'https://example.com/skills/{{name}}',
    });
    await mkdir(path.join(root, 'partials'));
    await writeFile(
      path.join(root, 'partials/install.md'),
      '# {{name}}\n\n{{version}} · {{PROJECT}} · [docs](SKILL.md) · {{source}}\n',
    );
    config.variables = { PROJECT: 'Loom' };
    config.skills.push({ name: 'other', source: 'other' });
    await mkdir(path.join(root, 'other'));
    await writeFile(
      path.join(root, 'other/SKILL.md'),
      skillSource.replace('name: demo', 'name: other'),
    );
    await build(config);
    const doc = await readFile(path.join(root, 'dist/skills/demo/SETUP.md'), 'utf8');
    expect(doc).toBe(
      '# demo\n\n1.0.0 · Loom · [docs](https://gitlab.example.com/group/repo/-/raw/main/skills/demo/SKILL.md) · https://example.com/skills/demo\n',
    );
    await expect(readFile(path.join(root, 'dist/skills/other/SETUP.md'), 'utf8')).rejects.toThrow();
  });

  it('keeps a hand-written INSTALL.md from the source directory', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root, config } = await fixture(true);
    await writeFile(path.join(root, 'src/INSTALL.md'), '# 手写安装说明\n');
    await build(config);
    expect(await readFile(path.join(root, 'dist/skills/demo/INSTALL.md'), 'utf8')).toBe(
      '# 手写安装说明\n',
    );
    expect(warn).toHaveBeenCalledWith(
      'Warning: demo: INSTALL.md exists in source or output, install doc skipped',
    );
  });
});
