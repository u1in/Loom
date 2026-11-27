import { z } from 'zod';
import { createJiti } from 'jiti';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LoomConfig, LoadedConfig } from './types';
const content = z.union([z.string(), z.object({ file: z.string() }).strict()]);
const noticeItem = z.union([
  z.string(),
  z
    .object({ file: z.string().min(1), headingShift: z.number().int().min(0).max(5).optional() })
    .strict(),
]);
const scope = z.array(z.string()).optional();
const schema = z
  .object({
    version: z.literal(1),
    skills: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            source: z.string().min(1),
            entry: z
              .string()
              .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/)
              .optional(),
          })
          .strict(),
      )
      .min(1),
    output: z.string().min(1).default('dist'),
    commonNotice: z.union([noticeItem, z.array(noticeItem)]).optional(),
    variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
    injections: z
      .object({
        text: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z][a-z0-9-]*$/),
                position: z.enum(['top', 'bottom']),
                skills: scope,
                content,
              })
              .strict(),
          )
          .optional(),
        metadata: z
          .array(
            z
              .object({
                skills: scope,
                path: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/),
                value: z.unknown(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    plugins: z.array(z.unknown()).optional(),
    replacements: z
      .array(
        z
          .object({
            search: z.string().min(1),
            replace: z.string(),
            flags: z.enum(['g', 'i', 'gi', 'ig']).optional(),
            skills: scope,
            files: scope,
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const names = c.skills.map((s) => s.name);
    if (new Set(names).size !== names.length)
      ctx.addIssue({ code: 'custom', path: ['skills'], message: 'Skill names must be unique' });
    for (const k of Object.keys(c.variables ?? {}))
      if (['name', 'skill', 'version'].includes(k))
        ctx.addIssue({ code: 'custom', path: ['variables', k], message: 'Reserved variable' });
    const ids = (c.injections?.text ?? []).map((t) => t.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['injections', 'text'],
        message: 'Injection ids must be unique',
      });
    for (const [i, item] of (c.injections?.metadata ?? []).entries()) {
      if (
        ['version', 'name', 'commonNotice', '__proto__', 'constructor', 'prototype'].some((k) =>
          item.path.split('.').includes(k),
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['injections', 'metadata', i, 'path'],
          message: 'Reserved path',
        });
      try {
        if (JSON.stringify(item.value) === undefined) throw Error();
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['injections', 'metadata', i, 'value'],
          message: 'Value must be JSON serializable',
        });
      }
    }
    for (const item of [
      ...(c.injections?.text ?? []),
      ...(c.injections?.metadata ?? []),
      ...(c.replacements ?? []),
    ])
      for (const name of item.skills ?? [])
        if (!names.includes(name))
          ctx.addIssue({ code: 'custom', message: 'Unknown skill: ' + name });
  });
export const defineConfig = ((
  input: LoomConfig | Promise<LoomConfig> | (() => LoomConfig | Promise<LoomConfig>),
): LoomConfig | Promise<LoomConfig> => {
  const value = typeof input === 'function' ? input() : input;
  return value instanceof Promise
    ? value.then((v) => schema.parse(v) as LoomConfig)
    : (schema.parse(value) as LoomConfig);
}) as {
  (input: LoomConfig): LoomConfig;
  (
    input: Promise<LoomConfig> | (() => LoomConfig | Promise<LoomConfig>),
  ): LoomConfig | Promise<LoomConfig>;
};
let configImportCounter = 0;
export const loadConfig = async (cwd = process.cwd()): Promise<LoadedConfig> => {
  let file = '';
  for (const ext of ['ts', 'mts', 'js', 'mjs']) {
    const p = path.resolve(cwd, 'loom.config.' + ext);
    try {
      await access(p);
      file = p;
      break;
    } catch {
      // Try the next supported configuration extension.
    }
  }
  if (!file) throw new Error('No loom.config.ts, .mts, .js or .mjs found in ' + cwd);
  try {
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    // Native ESM imports are cached independently of jiti's moduleCache.
    const mod = (
      file.endsWith('.mjs')
        ? await import(pathToFileURL(file).href + '?loom=' + configImportCounter++)
        : await jiti.import(file)
    ) as {
      default: LoomConfig | Promise<LoomConfig> | (() => LoomConfig | Promise<LoomConfig>);
    };
    const input = typeof mod.default === 'function' ? mod.default() : mod.default;
    const config = await defineConfig(await input);
    return { ...config, output: config.output ?? 'dist', rootDir: path.dirname(file) };
  } catch (e) {
    throw new Error('Failed to load config ' + file + ': ' + String(e), { cause: e });
  }
};
