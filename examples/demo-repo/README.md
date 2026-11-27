# demo-repo

Loom 的端到端示例，同时是 workspace 成员。它用一份真实配置跑通两个 Skill 的公共说明、变量插值、注入、替换、自定义插件和官方安装文档插件。

```bash
pnpm --filter demo-repo build   # loom build
pnpm --filter demo-repo test    # loom build --check-determinism
```

## 文件

```text
demo-repo/
├── loom.config.ts
├── src/
│   ├── partials/notice.md
│   └── skills/
│       ├── pr-review/SKILL.md
│       └── release-notes/SKILL.md
└── skills/            # 纳入版本管理的示例构建产物
```

`skills/` 是供查看的示例产物，源码或配置变更后请重新构建并一同更新；不要手动修改产物。`.loom-cache/` 仍被 Git 忽略。

## 配置演示了什么

```ts
import { defineConfig } from '@u1in/loom-core';
import { installDoc } from '@u1in/loom-plugin-install-doc';
import type { LoomPlugin } from '@u1in/loom-core';

const gitCheck: LoomPlugin = {
  name: 'demo-git-check',
  apply: (api) => {
    api.addTransform((tree) => {
      tree.children.push(
        { type: 'heading', depth: 2, children: [{ type: 'text', value: '使用前检查' }] },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '请确认已安装 Git 2.30 或更新版本。' }],
        },
      );
      return tree;
    });
  },
};

export default defineConfig({
  skills: [
    { name: 'pr-review', source: 'src/skills/pr-review' },
    { name: 'release-notes', source: 'src/skills/release-notes' },
  ],
  commonNotice: { file: 'src/partials/notice.md' },
  variables: { PROJECT_NAME: 'Loom Demo' },
  injections: {
    text: [{ id: 'footer', position: 'bottom', content: 'Built for {{PROJECT_NAME}}.' }],
    metadata: [{ path: 'category', value: 'demo' }],
  },
  plugins: [gitCheck, installDoc()],
  replacements: [{ search: 'EXAMPLE_PROJECT', replace: 'Loom Demo' }],
});
```

| 能力 | 观察点 |
|---|---|
| 版本注入 | 产物 `metadata.version` 与源码一致（`1.0.0` / `0.1.0`） |
| 公共说明 | `pr-review` 标题后是 `This skill belongs to Loom Demo.` |
| 跳过公共说明 | `release-notes` 的 frontmatter 带 `metadata.loom.commonNotice: false`，产物没有这段 |
| 变量插值 | 公共说明、正文里的 `{{PROJECT_NAME}}` 都变成 `Loom Demo` |
| 文本注入 | 末尾出现 `Built for Loom Demo.`（`bottom` 位置） |
| metadata 注入 | 两个 Skill 都有 `metadata.loom.injections.category: demo` |
| 字符串替换 | `release-notes` 正文的 `EXAMPLE_PROJECT` 被替换 |
| 自定义插件 | `gitCheck` 注册 AST 变换，在末尾追加 `## 使用前检查` |
| 官方安装文档插件 | 在 `plugins` 中显式注册 `installDoc()`，生成 `INSTALL.md` |
| 无注释标记 | 产物中不存在 `<!-- loom:... -->`；作者自写注释会保留 |

这个示例用显式 `skills` 列出两个源码目录。pnpm 子包可以用 `skillsPath` 自动发现入口，并用 `exclude` 过滤开发文件。见 [Loom 工作区配置示例](../../README.md#源码目录和入口)。

## 预期产物

```text
skills/pr-review/SKILL.md
skills/pr-review/INSTALL.md
skills/release-notes/SKILL.md
skills/release-notes/INSTALL.md
```

`pr-review` 的产物结构：

```markdown
---
name: pr-review
description: Review changes for correctness and regressions.
metadata:
  version: 1.0.0
  loom:
    injections:
      category: demo
---

# PR Review

This skill belongs to Loom Demo.

Inspect the changes in Loom Demo and report actionable findings.

Built for Loom Demo.

## 使用前检查

请确认已安装 Git 2.30 或更新版本。
```

顺序固定为：作者标题 → 公共说明 → 作者正文 → `bottom` 注入 → 插件追加内容。`release-notes` 只是少了第一段。

## 确定性

`pnpm --filter demo-repo test` 会连续构建两次并比较文件哈希。这份配置不含时间戳、随机值和环境读取，因此必须通过。如果你新增的插件或配置让这条命令失败，问题在新增内容，而不在示例本身。
