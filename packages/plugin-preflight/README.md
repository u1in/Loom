# @u1in/loom-plugin-preflight

给 Skill 产物加一段“使用前检查”说明，把依赖的工具与环境变量写进 `metadata.loom.preflight`，并且可以按配置发射一个检查脚本。

它是 [`injections`](../core/README.md) 的语义化封装：做的事情用通用 `addTransform` + `addMetadataTransform` + `onEmitFiles` 也能做，只是这里把这套约定固化成配置。它同时也是「第三方插件能复刻内置能力」的验证样本。

```bash
pnpm add -D @u1in/loom-plugin-preflight
```

`@u1in/loom-core` 是 peer dependency，需与插件一同安装。

## 用法

```ts
// loom.config.ts
import { defineConfig } from '@u1in/loom-core';
import preflight from '@u1in/loom-plugin-preflight';

export default defineConfig({
  skills: [
    { name: 'pr-review', source: 'src/skills/pr-review' },
    { name: 'release-notes', source: 'src/skills/release-notes' },
  ],
  plugins: [
    preflight({
      tools: [{ name: 'git', version: '>=2.30', required: true }],
      env: [{ name: 'GITHUB_TOKEN', required: true, description: 'GitHub API token' }],
      checks: [{ file: 'scripts/preflight.js', template: './templates/preflight-github.js' }],
      perSkill: {
        'release-notes': { tools: [], env: [] },
      },
    }),
  ],
});
```

## 选项

| 选项 | 类型 | 说明 |
|---|---|---|
| `tools` | `{ name, version?, required? }[]` | 需要的外部工具；`version` 是给人看的版本要求文案 |
| `env` | `{ name, required?, description? }[]` | 需要的环境变量；只描述，不读取值 |
| `checks` | `{ file, template }[]` | 从 `template` 读取脚本、插值后发射到 Skill 内的 `file` |
| `perSkill` | `Record<string, { tools?, env? }>` | 按 Skill 名覆盖 `tools` / `env` |

`perSkill` 是对象级覆盖：对应 Skill 只要提供了 `tools` 或 `env`，就整体替换顶层同名数组，而不是合并。上例里 `release-notes` 因此不带任何前置依赖。

选项在**创建插件实例时**就用 zod 校验，配置写错会立刻抛错，而不是等到构建。

## 产物形态

正文末尾追加一个二级标题区块（位于 `text(bottom)` 注入之后）：

```markdown
## 使用前检查

- 工具: git >=2.30（必需）
- 环境变量: GITHUB_TOKEN（必需） — GitHub API token
```

metadata 写入 `metadata.loom.preflight`：

```yaml
metadata:
  version: 1.0.0
  loom:
    preflight:
      tools:
        - name: git
          version: ">=2.30"
          required: true
      env:
        - name: GITHUB_TOKEN
          required: true
          description: GitHub API token
```

未配置的数组会写为空数组 `[]`，便于消费方无脑读取。

## 脚本发射

`checks[].template` 是相对配置根目录的路径，构建时读取、做变量插值后，作为 Skill 内的相对文件发射：

| 可用变量 | 值 |
|---|---|
| `name` / `skill` | 当前 Skill 名 |
| `version` | 当前 Skill 版本 |
| 自定义变量 | 配置中的 `variables` |

未知占位符原样保留。脚本**只发射、不执行**，是否运行由宿主或使用者决定。发射的文件同样参与产物链接校验，但不会再走替换管线。

## 确定性

给定相同的选项与模板内容，产物完全确定：不读时间、不读随机值、不使用环境变量值。因此可以安全地和 `--check-determinism` 一起用。

## 注意

- 正文区块注册在 `before-replace` 阶段，因此其中的文本会参与全局替换规则。如果你的替换规则可能命中“使用前检查”里的字面量，请用 `skills` / `files` 收窄规则。
- 插件不得修改 `name`、`metadata.version`、`metadata.loom.commonNotice`，本插件只写 `metadata.loom.preflight`。
- 模板文件不存在时构建失败，错误会指向该次 `onEmitFiles` 调用。
