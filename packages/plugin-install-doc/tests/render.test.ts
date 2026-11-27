import { describe, it, expect, vi } from 'vitest';
import { deriveSource, renderInstallDoc } from '../src/render';

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
