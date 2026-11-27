import { z } from 'zod';
import { createJiti } from 'jiti';
import fg from 'fast-glob';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LoomConfig, LoadedConfig } from './types';
import { parseSkillDocument } from './markdown';
const skillName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const skillFrontmatter = z.object({ name: skillName });
const content = z.union([z.string(), z.object({ file: z.string() }).strict()]);
const noticeItem = z.union([
  z.string(),
  z
    .object({ file: z.string().min(1), headingShift: z.number().int().min(0).max(5).optional() })
    .strict(),
]);
const scope = z.array(z.string()).optional();
const installDoc = z.union([
  z.boolean(),
  z
    .object({
      file: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/)
        .optional(),
      source: z.string().min(1).optional(),
      template: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      skills: scope,
    })
    .strict()
    .refine((v) => !(v.template && v.text), 'template and text are mutually exclusive'),
]);
const schema = z
  .object({
    skills: z
      .array(
        z
          .object({
            name: skillName,
            source: z.string().min(1),
            entry: z
              .string()
              .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    skillsPath: z.string().min(1).optional(),
    exclude: z.array(z.string().min(1)).optional(),
    output: z.string().min(1).default('.'),
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.search && !url.hash;
      }, 'baseUrl must be an HTTP(S) URL without query or fragment')
      .optional(),
    commonNotice: z.union([noticeItem, z.array(noticeItem)]).optional(),
    variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
    installDoc: installDoc.optional(),
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
    if (c.skills && c.skillsPath)
      ctx.addIssue({
        code: 'custom',
        path: ['skillsPath'],
        message: 'skills and skillsPath are mutually exclusive',
      });
    const names = new Set(c.skills?.map((s) => s.name));
    if (c.skills && names.size !== c.skills.length)
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
    if (!c.skills) return;
    for (const item of [
      ...(c.injections?.text ?? []),
      ...(c.injections?.metadata ?? []),
      ...(c.replacements ?? []),
      ...(typeof c.installDoc === 'object' ? [c.installDoc] : []),
    ])
      for (const name of item.skills ?? [])
        if (!names.has(name)) ctx.addIssue({ code: 'custom', message: 'Unknown skill: ' + name });
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
const readSkillName = async (rootDir: string, file: string): Promise<string> => {
  const raw = await readFile(path.resolve(rootDir, file), 'utf8');
  const { frontmatter } = parseSkillDocument(raw, file);
  const result = skillFrontmatter.safeParse(frontmatter);
  if (!result.success) throw new Error(file + ': invalid or missing frontmatter name');
  return result.data.name;
};

const discoverSkills = async (
  rootDir: string,
  skillsPath?: string,
): Promise<LoadedConfig['skills']> => {
  const entries = await fg(skillsPath ?? 'src/skills/*/SKILL.source.md', {
    cwd: rootDir,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  if (!entries.length)
    throw new Error(
      skillsPath
        ? 'No skills found for skillsPath: ' + skillsPath
        : 'No skills found. Expected src/skills/<name>/SKILL.source.md',
    );
  return Promise.all(
    entries.sort().map(async (file) => {
      const source = path.posix.dirname(file);
      const entry = path.posix.basename(file);
      const name = skillsPath ? await readSkillName(rootDir, file) : path.posix.basename(source);
      return { name, source, entry };
    }),
  );
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
    const rootDir = path.dirname(file);
    const skills = config.skills ?? (await discoverSkills(rootDir, config.skillsPath));
    if (!config.skills) schema.parse({ ...config, skillsPath: undefined, skills });
    return { ...config, skills, output: config.output ?? '.', rootDir };
  } catch (e) {
    throw new Error('Failed to load config ' + file + ': ' + String(e), { cause: e });
  }
};
