# demo-repo

Loom 的端到端示例，同时是 workspace 成员。它用一份真实配置跑通「两个 Skill × 公共说明 × 变量插值 × 注入 × 替换 × 官方插件」的完整链路，任何改动的验收都可以先在这里跑一遍。

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
import preflight from '@u1in/loom-plugin-preflight';

export default defineConfig({
  version: 1,
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
  plugins: [preflight({ tools: [{ name: 'git', version: '>=2.30', required: true }] })],
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
| 官方插件 | 末尾追加 `## 使用前检查`，metadata 写入 `metadata.loom.preflight` |
| 无注释标记 | 产物中不存在 `<!-- loom:... -->`；作者自写注释会保留 |

## 预期产物

```text
skills/pr-review/SKILL.md
skills/release-notes/SKILL.md
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
    preflight:
      tools:
        - name: git
          version: ">=2.30"
          required: true
      env: []
---

# PR Review

This skill belongs to Loom Demo.

Inspect the changes in Loom Demo and report actionable findings.

Built for Loom Demo.

## 使用前检查

- 工具: git >=2.30（必需）
```

顺序固定为：作者标题 → 公共说明 → 作者正文 → `bottom` 注入 → 插件追加内容。`release-notes` 只是少了第一段。

## 确定性

`pnpm --filter demo-repo test` 会连续构建两次并比较文件哈希。这份配置不含时间戳、随机值和环境读取，因此必须通过。如果你新增的插件或配置让这条命令失败，问题在新增内容，而不在示例本身。
