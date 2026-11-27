import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, hashFiles } from '../src/pipeline';
import { deriveSource, renderInstallDoc } from '../src/install-doc';
import type { LoadedConfig } from '../src/types';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const skillSource =
  '---\nname: demo\ndescription: 演示用 Skill\nmetadata:\n  version: 1.0.0\n---\n\n# Demo\n';

const fixture = async (installDoc: LoadedConfig['installDoc']) => {
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

describe('deriveSource', () => {
  it('preserves the GitLab ref and Skill directory, including repository subgroups', () => {
    expect(
      deriveSource(
        'https://gitlab.example.com/group/subgroup/repo/-/raw/skills-release/skills/demo/',
      ),
    ).toBe('https://gitlab.example.com/group/subgroup/repo/-/tree/skills-release/skills/demo');
  });

  it('derives GitHub tree links from raw and blob addresses', () => {
    const tree = 'https://github.com/u1in/Loom/tree/v1/skills/demo';
    expect(deriveSource('https://raw.githubusercontent.com/u1in/Loom/v1/skills/demo/')).toBe(tree);
    expect(
      deriveSource('https://raw.githubusercontent.com/u1in/Loom/refs/tags/v1/skills/demo/'),
    ).toBe(tree);
    expect(deriveSource('https://github.com/u1in/Loom/raw/v1/skills/demo/')).toBe(tree);
    expect(deriveSource('https://github.com/u1in/Loom/blob/v1/skills/demo/')).toBe(tree);
  });

  it('returns undefined for unknown hosts and missing baseUrl', () => {
    expect(deriveSource('https://cdn.example.com/skills/{{name}}/')).toBeUndefined();
    expect(deriveSource(undefined)).toBeUndefined();
    expect(deriveSource('not a url')).toBeUndefined();
  });
});

describe('renderInstallDoc', () => {
  const base = {
    name: 'demo',
    version: '1.0.0',
    description: '演示用 Skill',
    source: 'https://gitlab.example.com/group/repo.git',
  };

  it('renders a one-line Chinese prompt for the current harness', () => {
    const link =
      '[https://gitlab.example.com/group/repo.git](https://gitlab.example.com/group/repo.git)';
    expect(renderInstallDoc(base)).toBe(
      '请使用 `skills` CLI，从 ' + link + ' 将 `demo` 安装到当前 harness。\n',
    );
  });

  it('uses the local directory when no source is available', () => {
    expect(renderInstallDoc({ name: 'demo', version: '1.0.0' })).toBe(
      '请从本目录将 `demo` 安装到当前 harness。\n',
    );
  });

  it('interpolates templates and keeps unknown variables', () => {
    const warn = vi.fn();
    const doc = renderInstallDoc({
      ...base,
      template: '{{name}}@{{version}} {{description}} {{EXTRA}} {{source}}\n',
      variables: { EXTRA: 'extra' },
      warn,
    });
    expect(doc).toBe('demo@1.0.0 演示用 Skill extra https://gitlab.example.com/group/repo.git\n');
    const unknown = renderInstallDoc({ ...base, template: '{{MISSING}}', warn });
    expect(unknown).toBe('{{MISSING}}\n');
    expect(warn).toHaveBeenCalledWith('install doc: unknown variable MISSING');
  });
});

describe('installDoc build', () => {
  it('emits a one-line INSTALL.md with the interpolated publishing address', async () => {
    const { root, config } = await fixture(true);
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
