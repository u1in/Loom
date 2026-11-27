import { z } from 'zod';
import type { LoomPlugin } from '@u1in/loom-core';
import { unified } from 'unified';
import parse from 'remark-parse';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const checkSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.string(),
        version: z.string().optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
  env: z
    .array(
      z.object({
        name: z.string(),
        required: z.boolean().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});
const schema = checkSchema.extend({
  checks: z.array(z.object({ file: z.string(), template: z.string() })).optional(),
  perSkill: z.record(checkSchema).optional(),
});
export type PreflightOptions = z.input<typeof schema>;
const preflight = (input: PreflightOptions): LoomPlugin => {
  const options = schema.parse(input);
  return {
    name: '@u1in/loom-plugin-preflight',
    apply: (api) => {
      const forSkill = (name: string) => ({ ...options, ...options.perSkill?.[name] });
      api.addTransform((tree, ctx) => {
        const opt = forSkill(ctx.skillName);
        const lines = [
          '## 使用前检查',
          ...(opt.tools ?? []).map(
            (t) =>
              '- 工具: ' +
              t.name +
              (t.version ? ' ' + t.version : '') +
              (t.required ? '（必需）' : ''),
          ),
          ...(opt.env ?? []).map(
            (e) =>
              '- 环境变量: ' +
              e.name +
              (e.required ? '（必需）' : '') +
              (e.description ? ' — ' + e.description : ''),
          ),
        ];
        const nodes = unified().use(parse).parse(lines.join('\n')).children;
        tree.children.push(...nodes);
        return tree;
      });
      api.addMetadataTransform((fm, ctx) => {
        const m = (fm.metadata ?? {}) as Record<string, unknown>;
        const loom = (m.loom ?? {}) as Record<string, unknown>;
        const opt = forSkill(ctx.skillName);
        loom.preflight = { tools: opt.tools ?? [], env: opt.env ?? [] };
        m.loom = loom;
        fm.metadata = m;
        return fm;
      });
      api.onEmitFiles(async (ctx) => {
        for (const check of options.checks ?? []) {
          const source = await readFile(
            path.resolve(ctx.build.config.rootDir, check.template),
            'utf8',
          );
          const vars: Record<string, string> = {
            ...ctx.build.variables,
            name: ctx.skillName,
            skill: ctx.skillName,
            version: ctx.version,
          };
          ctx.emit(
            check.file,
            source.replace(
              /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g,
              (match, key: string) => vars[key] ?? match,
            ),
          );
        }
      });
    },
  };
};
export default preflight;
