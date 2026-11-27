# @u1in/loom-test-utils

给插件作者用的测试辅助：构造 `BuildContext` / `SkillContext`，以及一个能把插件的注册结果“拆开”的 `runPlugin`。

插件的 `apply()` 本身不返回值——它只是往 `PluginAPI` 上注册函数。测试要验证的恰恰是“注册了什么、注册到哪个阶段”，这个包就把这些注册结果收集成可直接断言的数组。

```bash
pnpm add -D @u1in/loom-test-utils vitest
```

`@u1in/loom-core` 是 peer dependency。

## 导出

| 导出 | 说明 |
|---|---|
| `createTestBuildContext(overrides?)` | 造一个 `BuildContext`，默认 Skill 名为 `test`、`rootDir` 为 `process.cwd()`、logger 静默 |
| `createTestSkillContext(overrides?)` | 造一个 `SkillContext`，默认版本 `1.0.0`、空 AST、`readSource` 返回空串 |
| `runPlugin(plugin, ctx?)` | 用给定上下文调用 `plugin.apply(api)`，返回收集到的注册结果 |

`runPlugin` 的返回值：

```ts
{
  api: PluginAPI;
  transforms: { fn: Transform; phase: 'before-replace' | 'after-replace' }[];
  metadata: MetadataTransform[];
  emits: ((ctx: EmitContext) => void | Promise<void>)[];
  hooks: {
    buildStart: ((ctx: BuildContext) => void | Promise<void>)[];
    buildEnd: ((ctx: BuildContext) => void | Promise<void>)[];
    skillStart: ((ctx: SkillContext) => void | Promise<void>)[];
    skillEnd: ((ctx: SkillContext) => void | Promise<void>)[];
  };
}
```

未显式指定 `phase` 的变换记为 `'before-replace'`，与真实管线默认值一致。

## 示例

```ts
import { describe, it, expect } from 'vitest';
import { runPlugin, createTestBuildContext } from '@u1in/loom-test-utils';
import type { LoomPlugin } from '@u1in/loom-core';

const plugin: LoomPlugin = {
  name: 'check-script',
  apply: (api) => {
    api.addTransform((tree) => tree);
    api.addTransform((tree) => tree, { phase: 'after-replace' });
    api.addMetadataTransform((fm) => fm);
    api.onEmitFiles((ctx) => ctx.emit('scripts/check.js', 'console.log("ok")'));
  },
};

describe('check-script', () => {
  it('registers transforms in the expected phases', async () => {
    const { transforms, metadata } = await runPlugin(plugin);
    expect(transforms.map((t) => t.phase)).toEqual(['before-replace', 'after-replace']);
    expect(metadata).toHaveLength(1);
  });

  it('emits the check script', async () => {
    const { emits } = await runPlugin(plugin);
    const files = new Map<string, string>();
    await emits[0]!({
      skillName: 'demo',
      version: '1.0.0',
      emit: (p, content) => files.set(p, String(content)),
      readSource: async () => '',
      build: createTestBuildContext(),
    });
    expect([...files.keys()]).toEqual(['scripts/check.js']);
  });
});
```

要单独跑某个 transform，需要自己准备 `TransformContext`（`runPlugin` 不构造它，因为 `interpolate` 依赖具体配置）：

```ts
import type { Root } from 'mdast';
import type { TransformContext } from '@u1in/loom-core';

const ctx = {
  skillName: 'demo',
  version: '1.0.0',
  variables: {},
  config: { skills: [], output: '.', rootDir: process.cwd() },
  logger: { info() {}, warn() {} },
  interpolate: (s: string) => s,
} as TransformContext;

const tree: Root = { type: 'root', children: [] };
const out = await transforms[0]!.fn(tree, ctx);
```

## 边界

- `runPlugin` 只跑到 `apply()`，**不执行管线**。要验证「注入内容是否参与替换」「保留字段是否被改」「产物哈希是否稳定」，应该直接调用 `@u1in/loom-core` 的 `build(config, options)`，在临时目录里用完整的 `LoadedConfig` 跑一遍。
- 上下文是普通对象，不是构建期实例，`tree` / `metadata` 没有实时 getter 语义。
- 默认 logger 静默，需要断言日志时用 `overrides.logger` 传入自己的实现。
