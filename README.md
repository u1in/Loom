# Loom

**用 TypeScript 配置、按线性 AST 管线预编译 Skill 的构建框架。**

开发者只写 Skill 的功能源码，Loom 在构建期把 Skill 的入口文件解析成 Markdown AST，依次执行版本注入、公共说明注入、插件变换、字符串替换，再重组为自包含、可单独安装、可被 `npx skills` 原生发现的产物。

```bash
pnpm add -D @u1in/loom-core
npx loom build
```

---

## 它解决什么问题

Skill 的源码散落在多个目录，每个都要有版本号、免责说明、环境前置检查、项目名占位符。这些重复内容要么手抄、要么写脚本正则替换。Loom 的做法是**把重复内容变成配置和构建期变换**，让源码只管功能本身：

- 版本号只在源码 frontmatter 写一次，构建时校验并回写产物。
- 公共说明从 `partials/notice.md` 统一注入，不污染每个 Skill 的源码。
- `{{PROJECT_NAME}}` 这类占位符在构建期插值，源码保持通用。
- 插件可以往 AST 里塞节点、改 metadata、发射脚本文件，能力与内置功能完全对等。

## 核心特性

| 特性 | 说明 |
|---|---|
| 线性纯函数管线 | 变换顺序写死在管线里，不存在洋葱模型的“环绕”语义，也没有事件总线 |
| TypeScript 配置 | `defineConfig` 提供类型推断，zod 做运行时校验，拼错字段会直接报错 |
| 插件一等公民 | 内置 `injections` 与第三方插件走同一套 `PluginAPI` |
| 确定性构建 | 相同源码 + 相同配置 + 相同版本，两次构建产物逐字节一致 |
| 安全写出 | 先写临时目录，替换前备份旧产物；替换失败时尝试恢复 |
| 产物自检 | 校验 frontmatter、版本、Markdown 相对链接，断链即构建失败 |
| 二进制安全 | 通过 `\0` 字节判定二进制，只复制不替换；文本统一规范化为 LF |

## 快速开始

要求 Node.js ≥ 20、pnpm ≥ 9。

### 1. 准备目录

```text
my-skills/
├── loom.config.ts
├── partials/
│   └── notice.md
└── src/skills/
    ├── pr-review/
    │   ├── SKILL.source.md
    │   └── references/checklist.md
    └── release-notes/
        └── SKILL.source.md
```

`SKILL.source.md` 的 frontmatter 必须包含与目录名一致的 `name`，以及合法 SemVer 格式的 `metadata.version`：

```markdown
---
name: pr-review
description: Review changes for correctness and regressions.
metadata:
  version: 1.0.0
---

# PR Review

Inspect the changes in {{PROJECT_NAME}} and report actionable findings.
```

### 2. 写配置

```ts
// loom.config.ts
import { defineConfig } from '@u1in/loom-core';

export default defineConfig({
  commonNotice: { file: 'partials/notice.md' },
  variables: { PROJECT_NAME: 'MyProject' },
  injections: {
    text: [{ id: 'footer', position: 'bottom', content: 'Built for {{PROJECT_NAME}}.' }],
    metadata: [{ path: 'category', value: 'review' }],
  },
  replacements: [{ search: 'EXAMPLE_PROJECT', replace: 'MyProject' }],
});
```

配置支持 `.ts` / `.mts` / `.js` / `.mjs`，相对路径一律以配置文件所在目录为基准。

### 3. 构建

```bash
npx loom build
```

```text
✔ pr-review@1.0.0 → skills/pr-review
✔ release-notes@0.1.0 → skills/release-notes
```

产物形如：

```text
skills/pr-review/
├── SKILL.md            # 含公共说明、插件内容和替换结果
├── INSTALL.md          # 安装指引
└── references/
    └── checklist.md    # 文本资源同样应用替换
```

`skills/pr-review/` 可以整体复制到任何兼容宿主中独立使用。

## CLI

| 命令 | 作用 |
|---|---|
| `loom build` | 构建全部 Skill |
| `loom build --skill pr-review` | 只构建指定 Skill，名称不存在时报错 |
| `loom build --out ./custom-dist` | 覆盖输出目录（相对配置文件目录解析） |
| `loom build --check` | 不写盘，校验现有产物是否与当前源码一致 |
| `loom build --check-determinism` | 在临时目录连续构建两次并比较哈希 |
| `loom --version` / `loom --help` | 版本与帮助 |

退出码：`0` 成功，`1` 构建失败，`2` 参数解析错误。任一 Skill 失败即整体失败，已完成的其他 Skill 产物保留。

## 配置一览

| 字段 | 必填 | 说明 |
|---|---|---|
| `skills` | | 显式列出 `{ name, source, entry? }[]`，`name` 唯一且匹配 `^[a-z0-9][a-z0-9-]*$` |
| `skillsPath` | | 匹配 Skill 入口文件的 glob，以配置目录为基准，与 `skills` 互斥 |
| `exclude` | | 复制资源时排除的 glob 列表，路径相对于每个 Skill 源码目录 |
| `output` | | 输出目录，默认 `.`，产物位于 `skills/` |
| `commonNotice` | | 字符串、文件或其有序数组，文件可配置 `headingShift` |
| `variables` | | 自定义插值变量，不可与 `name` / `skill` / `version` 重名 |
| `installDoc` | | 默认 `true`，自动注册官方安装文档插件；`false` 关闭自动注册，也可传配置对象 |
| `injections.text` | | 文本注入，`position` 为 `top` 或 `bottom`，参与插值与替换 |
| `injections.metadata` | | 写入 `metadata.loom.injections.<path>`，支持点号路径 |
| `plugins` | | `LoomPlugin` 实例数组 |
| `replacements` | | 字符串或正则替换，可用 `skills` / `files` 限定范围 |

有公共说明时，Loom 将它按顺序插在正文的第一个标题之后，再插入 `text(top)`。无标题时从 frontmatter 后开始插入。没有公共说明时，`text(top)` 位于 frontmatter 后。正文末尾依次为 `text(bottom)` 和插件追加内容。文本注入不生成任何 HTML 注释标记，作者自己写的注释会保留。

## 插件

官方安装文档插件在 [@u1in/loom-plugin-install-doc](packages/plugin-install-doc/README.md) 中提供。项目可以通过 `plugins` 注册自己的 `LoomPlugin`，示例见 [demo-repo](examples/demo-repo/README.md#配置演示了什么)。

原用于测试的 `@u1in/loom-plugin-env-probe`、`@u1in/loom-plugin-preflight` 和 `@u1in/loom-test-utils` 已从当前工作区移除，历史源码见 `v0.4.0` 标签。

插件以实例形式传入配置，核心不做模块名解析——用 `import` 和工厂函数自己完成这一步。插件运行在本机进程中，**必须信任其代码**，MVP 不提供沙箱。

```ts
import type { LoomPlugin } from '@u1in/loom-core';

const hello: LoomPlugin = {
  name: 'hello',
  apply: (api) => {
    api.addTransform((tree) => {
      tree.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'Hello' }] });
      return tree;
    });
  },
};
```

`addTransform` 默认注册在 `before-replace` 阶段（内容参与插值与替换）；显式传 `after-replace` 则跳过替换。插件不得修改 `name`、`metadata.version`、`metadata.loom.commonNotice`，命中即构建失败。

## 确定性

Loom 的核心承诺是：**核心管线与内置插件的产物逐字节可复现**。为此构建期不写时间戳、不写随机值、不保留 mtime，所有文件遍历按路径排序，换行统一为 `\n`，`remark-stringify` 与 `yaml.stringify` 使用固定选项。

`loom build --check-determinism` 会连续构建两次并比较文件哈希，适合放进 CI。破坏确定性的典型来源是配置里的随机值/时间戳，以及读取构建环境的插件。

## 发布 Skill

`npx skills` 对 GitHub 来源按**目录哈希**判断更新，`metadata.version` 只用于展示，**不是更新依据**。因此发布路径和产物文件集合必须稳定。

```bash
loom build
git checkout -B skills-release
git add skills
git commit -m "release: 2026-11-27"
git push origin skills-release
```

用户安装：

```bash
npx skills add https://github.com/OWNER/REPO/tree/skills-release/skills/pr-review
```

旧版本通过 Git tag 或 commit 安装。注意：源码改动但 `metadata.version` 未变时，构建只**警告**不阻断，产物仍会更新，`npx skills` 也能靠哈希发现变化。

## 仓库结构

```text
.
├── packages/
│   ├── core/                 # 配置、构建管线、PluginAPI 和 CLI
│   └── plugin-install-doc/   # 官方安装文档插件
├── examples/demo-repo/       # 端到端示例，也是样例验收基准
└── .changeset/               # 多包版本与 changelog 管理
```

构建缓存位于各项目根目录的 `.loom-cache/<skill>.json`（记录版本与源码哈希，仅用于生成“源码变了但版本没变”的告警），已加入 `.gitignore`。

## 本地开发

```bash
pnpm install
pnpm build              # 按依赖拓扑构建 packages/*
pnpm test               # 运行全部包测试
pnpm typecheck          # 源码、测试与 workspace 配置类型检查
pnpm check              # lint + format:check + typecheck
pnpm lint               # ESLint
pnpm format             # Prettier 写入
pnpm --filter demo-repo build                 # 端到端构建
pnpm --filter demo-repo test                  # 连跑两次比较确定性
```

发布流程：

```bash
pnpm changeset          # 记录变更与变更级别
pnpm version-packages   # 更新版本号、替换 workspace:*、生成 CHANGELOG
pnpm release            # 按依赖顺序发布官方插件和 Core
```

示例项目 `demo-repo` 在 changesets 的 `ignore` 列表中，不参与发布。

## 发布前检查

发布前确认 npm 账号权限、GitHub 仓库和 MIT 许可证配置：

1. 在 Node.js 20 或更高版本下运行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm check` 和 `pnpm test`。
2. 分别打包 `@u1in/loom-plugin-install-doc` 与 `@u1in/loom-core`，在干净目录验证两个包和示例构建。
3. 先发布 `@u1in/loom-plugin-install-doc`，再发布 `@u1in/loom-core`，最后验证从 npm 安装。
4. 将示例产物发布到 GitHub 的 `skills-release` 分支，用 `npx skills add`、`check` 和 `update` 验证兼容性。

`--check-determinism` 只比较同一机器上连续两次构建；读取环境的插件可能在其他环境生成不同产物。

## 子包文档

[Core 配置与 PluginAPI](packages/core/README.md) · [自定义插件示例](examples/demo-repo/README.md)

### 批量织入公共说明

`commonNotice` 支持有序数组，例如：

```ts
commonNotice: [
  { file: 'common/environment.md', headingShift: 1 },
  { file: 'common/shell.md', headingShift: 1 },
  '适用于 {{name}}。',
],
variables: { BASE: 'https://example.com' },
```

默认以 Skill 正文的第一个标题为基准，将每段公共说明中最浅的标题调整为其下一级，其余标题保持相对层级。Skill 或公共说明没有标题时保持原样。`headingShift` 可显式指定 0 到 5 的整数，覆盖自动调整。调整后超出一级至六级时构建失败。相对路径以配置文件目录为准。正文、链接、图片及引用链接的目标支持 `{{BASE}}` 等变量插值。设置 `metadata.loom.commonNotice: false` 时跳过全部公共说明。

### 源码目录和入口

省略 `skills` 和 `skillsPath` 时，Loom 在配置目录下查找 `src/skills/*/SKILL.source.md`，以一级子目录名作为 Skill 名，默认输出到 `skills/<name>/SKILL.md`。没有符合约定的入口时，构建会报错。

pnpm 工作区可以把每个 Skill 放在独立子包中：

```text
my-skills/
├── loom.config.ts
├── pnpm-workspace.yaml
├── partials/
│   └── notice.md
└── packages/
    └── pr-review/
        ├── package.json
        ├── SKILL.source.md
        └── references/checklist.md
```

在 `pnpm-workspace.yaml` 中注册 `packages/*`，在工作区根目录执行 `pnpm add -Dw @u1in/loom-core`。然后配置入口 glob 和资源排除规则：

```ts
import { defineConfig } from '@u1in/loom-core';

export default defineConfig({
  skillsPath: 'packages/*/SKILL.source.md',
  exclude: ['package.json', '**/node_modules/**'],
  commonNotice: { file: 'partials/notice.md' },
});
```

`skillsPath` 相对于配置目录匹配入口文件。Loom 从匹配文件的 frontmatter 读取 `name`，以文件所在目录作为源码目录。找不到入口、名称无效或名称重复时，构建会报错。

`exclude` 相对于每个 Skill 的源码目录匹配资源，排除子包的开发文件和依赖目录。Loom 仍会生成 `SKILL.md` 和默认的 `INSTALL.md`。可用 `loom build --skill pr-review` 单独构建一个子包。

需要逐项指定源码时，可显式配置 `skills`：

```ts
skills: [{ name: 'demo', source: 'src/skills/demo', entry: 'SKILL.source.md' }],
```

显式列出的 Skill 省略 `entry` 时读取源码目录内的 `SKILL.md`。Loom 将处理后的入口统一写成 `SKILL.md`。`entry` 只接受文件名。

### Markdown 链接地址

设置 `baseUrl` 后，Skill 产物中 Markdown 文件的相对链接、图片和引用链接会解析为绝对地址：

```ts
baseUrl: 'https://example.com/skills/{{name}}/',
```

`baseUrl` 是每个 Skill 发布目录的 HTTP(S) 地址，可使用 `{{name}}` 等变量。子目录中的 Markdown 链接相对于该文件解析，查询参数和章节锚点保留。仅含 `#锚点` 的链接、带协议的地址以及以 `//` 开头的地址保持原样。根路径链接按网站根目录解析。未设置时保留原链接并继续检查本地相对链接。

链接转为绝对地址后，访问引用内容需要访问对应网站，包括链接到随 Skill 分发资源的情况。

### 安装文档

Loom 默认启用官方安装文档插件，为每个 Skill 生成一句面向当前 harness 的中文安装指引。设置 `installDoc: true` 可以显式启用自动注册。也可以安装官方插件后，把实例放入 `plugins`：

```bash
pnpm add -D @u1in/loom-plugin-install-doc
```

```ts
import { defineConfig } from '@u1in/loom-core';
import { installDoc } from '@u1in/loom-plugin-install-doc';

export default defineConfig({
  plugins: [installDoc()],
});
```

`installDoc()` 的选项和 `installDoc: { ... }` 使用同一套配置。显式插件优先于自动注册。只设置 `installDoc: false` 可关闭自动生成。

生成的 Markdown 形如：

```markdown
请使用 `skills` CLI，从 [https://github.com/OWNER/REPO/tree/skills-release/skills/pr-review](https://github.com/OWNER/REPO/tree/skills-release/skills/pr-review) 将 `pr-review` 安装到当前 harness。
```

Loom 从 GitLab 或 GitHub 的 raw 发布地址推导安装链接，保留分支或标签以及 Skill 目录。使用 CDN 或其他来源时，设置 `installDoc.source` 指定安装地址，支持 `{{name}}` 等变量。缺少安装来源时，文案提示从当前目录安装。配置了无法推导的 `baseUrl` 时，构建会告警。

可选的 `template` 或 `text` 可覆盖默认文案。模板支持 `{{name}}`、`{{skill}}`、`{{version}}`、`{{description}}`、`{{source}}` 和配置中的 `variables`。`file` 可改文件名，`skills` 可限定生效范围。

生成的文档与其他 Markdown 产物一样参与 `baseUrl` 链接补全和 `--check`。源码或构建产物已有同名文件时跳过并告警。
