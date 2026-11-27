import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { deriveSource, renderInstallDoc } from './render';

export interface InstallDocOptions {
  file?: string;
  source?: string;
  template?: string;
  text?: string;
  skills?: string[];
}

interface InstallDocEmitContext {
  skillName: string;
  version: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly baseUrl?: string;
  interpolate(text: string): string;
  hasOutputFile(path: string): boolean;
  emit(path: string, content: string): void;
}

interface InstallDocPluginAPI {
  readonly ctx: {
    config: {
      rootDir: string;
      skills: readonly { name: string; entry?: string }[];
    };
    logger: { warn(message: string): void };
    variables: Record<string, string>;
  };
  onEmitFiles(fn: (ctx: InstallDocEmitContext) => void | Promise<void>): void;
}

export const INSTALL_DOC_PLUGIN_NAME = 'loom:install-doc';

export const installDocOptionsSchema = z
  .object({
    file: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/)
      .optional(),
    source: z.string().min(1).optional(),
    template: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    skills: z.array(z.string()).optional(),
  })
  .strict()
  .refine(
    (options) => !(options.template && options.text),
    'template and text are mutually exclusive',
  );

export const installDoc = (input: InstallDocOptions = {}) => {
  const options = installDocOptionsSchema.parse(input);
  const file = options.file ?? 'INSTALL.md';

  return {
    name: INSTALL_DOC_PLUGIN_NAME,
    apply: (api: InstallDocPluginAPI) => {
      const { config, logger, variables } = api.ctx;
      const entries = new Map(config.skills.map((skill) => [skill.name, skill.entry]));
      for (const name of options.skills ?? [])
        if (!entries.has(name)) throw new Error('Unknown skill: ' + name);
      api.onEmitFiles(async (ctx) => {
        if (options.skills && !options.skills.includes(ctx.skillName)) return;
        if (file === entries.get(ctx.skillName) || ctx.hasOutputFile(file)) {
          logger.warn(
            ctx.skillName + ': ' + file + ' exists in source or output, install doc skipped',
          );
          return;
        }
        const template = options.template
          ? await readFile(path.resolve(config.rootDir, options.template), 'utf8')
          : options.text;
        const source = options.source ? ctx.interpolate(options.source) : deriveSource(ctx.baseUrl);
        if (!source && ctx.baseUrl)
          logger.warn(
            ctx.skillName + ': install source is unknown, set installDoc.source to provide it',
          );
        ctx.emit(
          file,
          renderInstallDoc({
            name: ctx.skillName,
            version: ctx.version,
            description:
              typeof ctx.metadata.description === 'string' ? ctx.metadata.description : undefined,
            source,
            template,
            variables,
            warn: logger.warn,
          }),
        );
      });
    },
  };
};
