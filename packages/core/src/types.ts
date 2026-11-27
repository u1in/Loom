import type { Root } from 'mdast';
export type Content = string | { file: string };
export type CommonNoticeItem = string | { file: string; headingShift?: number };
export interface LoomConfig {
  version: 1;
  skills: { name: string; source: string; entry?: string }[];
  output?: string;
  commonNotice?: CommonNoticeItem | CommonNoticeItem[];
  variables?: Record<string, string>;
  injections?: {
    text?: { id: string; position: 'top' | 'bottom'; skills?: string[]; content: Content }[];
    metadata?: { skills?: string[]; path: string; value: unknown }[];
  };
  plugins?: LoomPlugin[];
  replacements?: {
    search: string;
    replace: string;
    flags?: 'g' | 'i' | 'gi' | 'ig';
    skills?: string[];
    files?: string[];
  }[];
}
export type LoadedConfig = LoomConfig & { output: string; rootDir: string };
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}
export interface BuildEnv {
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  cwd: string;
  loomVersion: string;
}
export interface BuildContext {
  config: LoadedConfig;
  env: BuildEnv;
  variables: Record<string, string>;
  logger: Logger;
  loomVersion: string;
}
export interface TransformContext {
  skillName: string;
  version: string;
  variables: Record<string, string>;
  config: LoadedConfig;
  logger: Logger;
  interpolate(text: string): string;
}
export interface SkillContext {
  skillName: string;
  version: string;
  sourceDir: string;
  outputDir: string;
  readonly tree: Root;
  readonly metadata: Record<string, unknown>;
  readSource(path: string): Promise<string>;
}
export interface EmitContext {
  skillName: string;
  version: string;
  emit(path: string, content: string | Buffer): void;
  readSource(path: string): Promise<string>;
  readonly build: BuildContext;
}
export type Transform = (tree: Root, ctx: TransformContext) => Root | Promise<Root>;
export type MetadataTransform = (
  metadata: Record<string, unknown>,
  ctx: TransformContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;
export interface PluginAPI {
  readonly ctx: BuildContext;
  addTransform(t: Transform, options?: { phase?: 'before-replace' | 'after-replace' }): void;
  addMetadataTransform(t: MetadataTransform): void;
  onEmitFiles(fn: (ctx: EmitContext) => void | Promise<void>): void;
  onBuildStart(fn: (ctx: BuildContext) => void | Promise<void>): void;
  onSkillStart(fn: (ctx: SkillContext) => void | Promise<void>): void;
  onSkillEnd(fn: (ctx: SkillContext) => void | Promise<void>): void;
  onBuildEnd(fn: (ctx: BuildContext) => void | Promise<void>): void;
}
export interface LoomPlugin {
  name: string;
  apply(api: PluginAPI): void | Promise<void>;
}
