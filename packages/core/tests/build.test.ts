import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, hashFiles } from '../src/pipeline';
import { defineConfig } from '../src/config';
import type { LoadedConfig, LoomPlugin } from '../src/types';
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loom-test-'));
  dirs.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(
    path.join(root, 'src', 'SKILL.md'),
    '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n# Hello {{PROJECT}}\n\nTOKEN\n',
  );
  await writeFile(path.join(root, 'src', 'asset.txt'), 'TOKEN\r\n');
  const config: LoadedConfig = {
    version: 1,
    rootDir: root,
    output: 'dist',
    skills: [{ name: 'demo', source: 'src' }],
    variables: { PROJECT: 'World' },
    commonNotice: 'Notice {{name}}',
    injections: {
      text: [
        { id: 'one', position: 'top', content: 'Top 1' },
        { id: 'two', position: 'top', content: 'Top 2' },
        { id: 'end', position: 'bottom', content: 'Bottom' },
      ],
      metadata: [{ path: 'a.b', value: 1 }],
    },
    replacements: [{ search: 'TOKEN', replace: 'Replaced' }],
  };
  return { root, config, output: path.join(root, 'dist/skills/demo/SKILL.md') };
};
describe('build', () => {
  it('builds deterministic standalone output with ordered injections, assets and metadata', async () => {
    const { root, config, output } = await fixture();
    await build(config);
    const md = await readFile(output, 'utf8');
    expect(md).not.toContain('<!-- loom:');
    expect(md).toContain('Notice demo');
    expect(md).toContain('Hello World');
    expect(md).toContain('Replaced');
    expect(md).toMatch(/a:\n\s+b: 1/);
    expect(md.indexOf('Notice demo')).toBeLessThan(md.indexOf('Top 1'));
    expect(md.indexOf('Top 1')).toBeLessThan(md.indexOf('Top 2'));
    expect(md.indexOf('Top 2')).toBeLessThan(md.indexOf('# Hello'));
    expect(await readFile(path.join(root, 'dist/skills/demo/asset.txt'), 'utf8')).toBe(
      'Replaced\n',
    );
    const first = await hashFiles(path.join(root, 'dist'));
    await build(config);
    expect(await hashFiles(path.join(root, 'dist'))).toEqual(first);
    await build(config, { check: true });
    await build(config, { checkDeterminism: true });
    await writeFile(path.join(root, 'dist/skills/demo/asset.txt'), 'bad');
    await expect(build(config, { check: true })).rejects.toThrow('out of date');
  });
  it('weaves multiple notices in order, adjusts headings and interpolates link targets', async () => {
    const { root, config, output } = await fixture();
    await writeFile(
      path.join(root, 'notice.md'),
      '# First\n\n## Nested\n\n[link]({{BASE}}/{{name}})\n\n![image]({{BASE}}/image.png)\n\n[ref][target]\n\n[target]: {{BASE}}/reference\n',
    );
    await writeFile(path.join(root, 'second.md'), '# Second\n');
    config.variables = { ...config.variables, BASE: 'https://example.com' };
    config.commonNotice = [
      { file: 'notice.md', headingShift: 1 },
      { file: 'second.md', headingShift: 0 },
      'Last',
    ];
    await build(config);
    const md = await readFile(output, 'utf8');
    expect(md).toContain('## First');
    expect(md).toContain('### Nested');
    expect(md).toContain('[link](https://example.com/demo)');
    expect(md).toContain('https://example.com/image.png');
    expect(md).toContain('https://example.com/reference');
    expect(md.indexOf('## First')).toBeLessThan(md.indexOf('# Second'));
    expect(md.indexOf('# Second')).toBeLessThan(md.indexOf('Last'));
    expect(md.indexOf('Last')).toBeLessThan(md.indexOf('Top 1'));
    await build(config, { checkDeterminism: true });
    await writeFile(path.join(root, 'notice.md'), '###### Too deep\n');
    await expect(build(config)).rejects.toThrow('exceeds valid levels');
  });
  it('aligns common headings with the first skill heading and preserves their relative depth', async () => {
    const { root, config, output } = await fixture();
    config.injections = undefined;
    await writeFile(path.join(root, 'notice.md'), '## Notice\n\n### Detail\n');
    config.commonNotice = [{ file: 'notice.md' }];
    for (const [heading, expected] of [
      ['#', '##'],
      ['##', '###'],
      ['###', '####'],
    ]) {
      await writeFile(
        path.join(root, 'src', 'SKILL.md'),
        '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n' + heading + ' Skill\n',
      );
      await build(config);
      const md = await readFile(output, 'utf8');
      expect(md).toContain(expected + ' Notice');
      expect(md).toContain(expected + '# Detail');
    }
    await writeFile(
      path.join(root, 'src', 'SKILL.md'),
      '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\nNo heading\n',
    );
    await build(config);
    expect(await readFile(output, 'utf8')).toContain('## Notice');
    await writeFile(
      path.join(root, 'src', 'SKILL.md'),
      '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n###### Skill\n',
    );
    await expect(build(config)).rejects.toThrow('exceeds valid levels');
  });
  it('builds a custom source entry without distributing it', async () => {
    const { root, config, output } = await fixture();
    await writeFile(
      path.join(root, 'src', 'SKILL.source.md'),
      '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n# Source\n',
    );
    config.skills = [{ name: 'demo', source: 'src', entry: 'SKILL.source.md' }];
    await build(config);
    expect(await readFile(output, 'utf8')).toContain('# Source');
    expect(Object.keys(await hashFiles(path.dirname(output)))).not.toContain('SKILL.source.md');
    await build(config, { check: true });
    config.skills = [{ name: 'demo', source: 'src', entry: '../escape.md' }];
    await expect(build(config)).rejects.toThrow('invalid source entry');
  });
  it('rejects output that overlaps the source directory', async () => {
    const { root, config } = await fixture();
    config.output = '.';
    config.skills = [{ name: 'demo', source: 'skills/demo' }];
    await mkdir(path.join(root, 'skills/demo'), { recursive: true });
    await writeFile(
      path.join(root, 'skills/demo/SKILL.md'),
      '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n# Source\n',
    );
    await expect(build(config)).rejects.toThrow('source and output directories overlap');
    expect(await readFile(path.join(root, 'skills/demo/SKILL.md'), 'utf8')).toContain('# Source');
  });
  it('resolves Markdown links and images against the base URL for each file', async () => {
    const { root, config, output } = await fixture();
    config.commonNotice = undefined;
    config.injections = undefined;
    config.baseUrl = 'https://example.com/skills/{{name}}';
    await writeFile(
      path.join(root, 'src', 'SKILL.md'),
      '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n# Demo\n\n[guide](references/guide.md?x=1#part)\n\n![img](assets/image.png)\n\n[anchor](#demo)\n\n[external](https://other.test/a)\n\n[root](/legal)\n\n[cdn](//cdn.example.com/x)\n\n[mail](mailto:user@example.com)\n\n[reference][ref]\n\n[ref]: references/guide.md\n',
    );
    await mkdir(path.join(root, 'src', 'references'));
    await writeFile(
      path.join(root, 'src', 'references', 'guide.md'),
      '# Guide\n\n[back](../SKILL.md)\n\n[image](../assets/image.png)\n',
    );
    config.plugins = [
      {
        name: 'emit-doc',
        apply: (api) =>
          api.onEmitFiles((ctx) => ctx.emit('references/generated.md', '[home](../SKILL.md)\n')),
      },
    ];
    await build(config);
    const md = await readFile(output, 'utf8');
    expect(md).toContain('https://example.com/skills/demo/references/guide.md?x=1#part');
    expect(md).toContain('https://example.com/skills/demo/assets/image.png');
    expect(md).toContain('[anchor](#demo)');
    expect(md).toContain('https://other.test/a');
    expect(md).toContain('[root](https://example.com/legal)');
    expect(md).toContain('[cdn](//cdn.example.com/x)');
    expect(md).toContain('[mail](mailto:user@example.com)');
    expect(md).toContain('[ref]: https://example.com/skills/demo/references/guide.md');
    const guide = await readFile(path.join(root, 'dist/skills/demo/references/guide.md'), 'utf8');
    expect(guide).toContain('https://example.com/skills/demo/SKILL.md');
    expect(guide).toContain('https://example.com/skills/demo/assets/image.png');
    expect(
      await readFile(path.join(root, 'dist/skills/demo/references/generated.md'), 'utf8'),
    ).toContain('https://example.com/skills/demo/SKILL.md');
    await build(config, { check: true });
    await build(config, { checkDeterminism: true });
  });
  it('runs plugin hooks and transform phases in order', async () => {
    const { config, output } = await fixture();
    const calls: string[] = [];
    const plugin: LoomPlugin = {
      name: 'example',
      apply: (api) => {
        api.onBuildStart(() => {
          calls.push('buildStart');
        });
        api.onSkillStart(() => {
          calls.push('skillStart');
        });
        api.onSkillEnd(() => {
          calls.push('skillEnd');
        });
        api.onBuildEnd(() => {
          calls.push('buildEnd');
        });
        api.addTransform((tree) => {
          tree.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'TOKEN' }] });
          return tree;
        });
        api.addTransform(
          (tree) => {
            tree.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'TOKEN' }] });
            return tree;
          },
          { phase: 'after-replace' },
        );
        api.onEmitFiles((ctx) => ctx.emit('extra.txt', 'hello'));
      },
    };
    config.plugins = [plugin];
    await build(config);
    const md = await readFile(output, 'utf8');
    expect(md.trimEnd().endsWith('TOKEN')).toBe(true);
    expect(calls).toEqual(['buildStart', 'skillStart', 'skillEnd', 'buildEnd']);
  });
  it('rejects reserved metadata changes, path traversal, and broken links', async () => {
    const { config, root } = await fixture();
    config.plugins = [
      {
        name: 'bad',
        apply: (api) =>
          api.addMetadataTransform((fm) => {
            (fm.metadata as Record<string, unknown>).version = '2.0.0';
            return fm;
          }),
      },
    ];
    await expect(build(config)).rejects.toThrow('reserved');
    config.plugins = [
      { name: 'bad', apply: (api) => api.onEmitFiles((ctx) => ctx.emit('../escape', 'x')) },
    ];
    await expect(build(config)).rejects.toThrow('relative path');
    config.plugins = [];
    await writeFile(
      path.join(root, 'src', 'SKILL.md'),
      '---\nname: demo\nmetadata:\n  version: 1.0.0\n---\n\n[missing](./missing.md)\n',
    );
    await expect(build(config)).rejects.toThrow('broken link');
  });
  it('rejects invalid emitted SKILL.md and retains the previous output', async () => {
    const { config, output } = await fixture();
    await build(config);
    const original = await readFile(output, 'utf8');
    for (const content of [
      'invalid output',
      '---\\nname: other\\nmetadata:\\n  version: 1.0.0\\n---\\n',
    ]) {
      config.plugins = [
        {
          name: 'bad-output',
          apply: (api) => api.onEmitFiles((ctx) => ctx.emit('./SKILL.md', content)),
        },
      ];
      await expect(build(config)).rejects.toThrow(/output/);
      expect(await readFile(output, 'utf8')).toBe(original);
    }
  });
  it('preserves the current output and existing backup when a backup is present', async () => {
    const { config, root, output } = await fixture();
    await build(config);
    const original = await readFile(output, 'utf8');
    const backup = path.join(root, 'dist/skills/.demo.bak');
    await mkdir(backup);
    await writeFile(path.join(backup, 'saved.txt'), 'keep');
    await expect(build(config)).rejects.toThrow('Backup already exists');
    expect(await readFile(output, 'utf8')).toBe(original);
    expect(await readFile(path.join(backup, 'saved.txt'), 'utf8')).toBe('keep');
  });
  it('rejects bad configuration and preserves author-written comments', async () => {
    expect(() =>
      defineConfig({
        version: 1,
        skills: [{ name: 'demo', source: 'src' }],
        variables: { name: 'bad' },
      }),
    ).toThrow('Reserved');
    const { config, root, output } = await fixture();
    await writeFile(
      path.join(root, 'src', 'SKILL.md'),
      '---\nname: demo\nmetadata:\n  version: 1.0.0\n  loom:\n    commonNotice: false\n---\n\n<!-- author comment -->\n\n# Body\n',
    );
    await build(config);
    const md = await readFile(output, 'utf8');
    expect(md).toContain('<!-- author comment -->');
    expect(md).not.toContain('Notice demo');
    expect(md.indexOf('Top 1')).toBeLessThan(md.indexOf('Top 2'));
    expect(md.indexOf('Top 2')).toBeLessThan(md.indexOf('<!-- author comment -->'));
    expect(md.indexOf('# Body')).toBeLessThan(md.indexOf('Bottom'));
  });
  it('detects nondeterministic plugins and warns on unchanged versions', async () => {
    const { config, root } = await fixture();
    let count = 0;
    config.plugins = [
      {
        name: 'changing',
        apply: (api) => api.onEmitFiles((ctx) => ctx.emit('number.txt', String(count++))),
      },
    ];
    await expect(build(config, { checkDeterminism: true })).rejects.toThrow('Non-deterministic');
    config.plugins = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await build(config);
    await writeFile(path.join(root, 'src', 'asset.txt'), 'changed');
    await build(config);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('version unchanged'));
  });
});
