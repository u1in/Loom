import { expect, it } from 'vitest';
import { createTestBuildContext, createTestSkillContext, runPlugin } from '../src/index';
it('provides contexts and captures plugin registrations', async () => {
  const context = createTestBuildContext();
  expect(createTestSkillContext().skillName).toBe('test');
  const result = await runPlugin(
    {
      name: 'demo',
      apply: (api) => {
        api.addTransform((tree) => tree, { phase: 'after-replace' });
        api.onBuildStart(() => {});
      },
    },
    context,
  );
  expect(result.api.ctx).toBe(context);
  expect(result.transforms[0]?.phase).toBe('after-replace');
  expect(result.hooks.buildStart).toHaveLength(1);
});
