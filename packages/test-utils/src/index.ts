import type {
  BuildContext,
  LoomPlugin,
  PluginAPI,
  SkillContext,
  Transform,
  MetadataTransform,
  EmitContext,
} from '@u1in/loom-core';
import type { Root } from 'mdast';
export const createTestBuildContext = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  config: {
    version: 1,
    skills: [{ name: 'test', source: '.' }],
    output: 'dist',
    rootDir: process.cwd(),
  },
  env: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    loomVersion: '0.3.0',
  },
  variables: {},
  logger: { info: () => {}, warn: () => {} },
  loomVersion: '0.3.0',
  ...overrides,
});
export const createTestSkillContext = (overrides: Partial<SkillContext> = {}): SkillContext => ({
  skillName: 'test',
  version: '1.0.0',
  sourceDir: process.cwd(),
  outputDir: process.cwd(),
  tree: { type: 'root', children: [] } as Root,
  metadata: {},
  readSource: async () => '',
  ...overrides,
});
export const runPlugin = async (plugin: LoomPlugin, ctx = createTestBuildContext()) => {
  const transforms: { fn: Transform; phase: 'before-replace' | 'after-replace' }[] = [],
    metadata: MetadataTransform[] = [],
    emits: ((ctx: EmitContext) => void | Promise<void>)[] = [];
  const hooks: {
    buildStart: ((ctx: BuildContext) => void | Promise<void>)[];
    buildEnd: ((ctx: BuildContext) => void | Promise<void>)[];
    skillStart: ((ctx: SkillContext) => void | Promise<void>)[];
    skillEnd: ((ctx: SkillContext) => void | Promise<void>)[];
  } = { buildStart: [], buildEnd: [], skillStart: [], skillEnd: [] };
  const api: PluginAPI = {
    ctx,
    addTransform: (fn, options) => {
      transforms.push({ fn, phase: options?.phase ?? 'before-replace' });
    },
    addMetadataTransform: (fn) => {
      metadata.push(fn);
    },
    onEmitFiles: (fn) => {
      emits.push(fn);
    },
    onBuildStart: (fn) => {
      hooks.buildStart.push(fn);
    },
    onBuildEnd: (fn) => {
      hooks.buildEnd.push(fn);
    },
    onSkillStart: (fn) => {
      hooks.skillStart.push(fn);
    },
    onSkillEnd: (fn) => {
      hooks.skillEnd.push(fn);
    },
  };
  await plugin.apply(api);
  return { api, transforms, metadata, emits, hooks };
};
