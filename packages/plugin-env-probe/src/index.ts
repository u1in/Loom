import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import type { LoomPlugin } from '@u1in/loom-core';
const schema = z.object({
  mode: z.enum(['print', 'metadata', 'file']).default('print'),
  output: z.string().default('.loom-env.json'),
  probe: z
    .object({
      nodeVersion: z.boolean().optional(),
      platform: z.boolean().optional(),
      tools: z.array(z.string()).optional(),
      env: z.array(z.string()).optional(),
    })
    .default({}),
});
export type EnvProbeOptions = z.input<typeof schema>;
const envProbe = (input: EnvProbeOptions = {}): LoomPlugin => {
  const options = schema.parse(input);
  return {
    name: '@u1in/loom-plugin-env-probe',
    apply: (api) => {
      const snapshot = () => {
        const result: Record<string, unknown> = {};
        if (options.probe.nodeVersion) result.nodeVersion = api.ctx.env.nodeVersion;
        if (options.probe.platform) result.platform = api.ctx.env.platform;
        if (options.probe.tools)
          result.tools = Object.fromEntries(
            options.probe.tools.map((t) => {
              try {
                return [
                  t,
                  execFileSync(t, ['--version'], { encoding: 'utf8', timeout: 3000 })
                    .trim()
                    .split('\n')[0],
                ];
              } catch {
                return [t, null];
              }
            }),
          );
        if (options.probe.env)
          result.env = Object.fromEntries(
            options.probe.env.map((k) => [k, process.env[k] !== undefined]),
          );
        return result;
      };
      if (options.mode === 'print')
        api.onBuildStart(() => api.ctx.logger.info('Environment: ' + JSON.stringify(snapshot())));
      if (options.mode === 'metadata')
        api.addMetadataTransform((fm) => {
          const m = (fm.metadata ?? {}) as Record<string, unknown>;
          const loom = (m.loom ?? {}) as Record<string, unknown>;
          loom.env = snapshot();
          m.loom = loom;
          fm.metadata = m;
          return fm;
        });
      if (options.mode === 'file')
        api.onEmitFiles((ctx) =>
          ctx.emit(options.output, JSON.stringify(snapshot(), null, 2) + '\n'),
        );
    },
  };
};
export default envProbe;
