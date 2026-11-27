export type {
  LoomPlugin,
  PluginAPI,
  Transform,
  MetadataTransform,
  TransformContext,
  BuildContext,
  SkillContext,
  EmitContext,
  BuildEnv,
} from './types';
import type { LoomPlugin } from './types';
export const validatePlugins = (plugins: LoomPlugin[]): LoomPlugin[] => {
  for (const p of plugins)
    if (!p || typeof p.name !== 'string' || !p.name || typeof p.apply !== 'function')
      throw new Error('Invalid plugin: expected { name: string, apply: function }');
  return plugins;
};
