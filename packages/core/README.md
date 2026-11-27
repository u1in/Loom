# @u1in/loom-core

Loom 的核心包：配置加载与校验、Markdown AST 构建管线、PluginAPI、CLI，以及内置的 `injections` 插件。

```bash
pnpm add -D @u1in/loom-core
```

安装后即可使用 `loom` 命令，无需额外安装任何插件。

## 快速开始

```ts
// loom.config.ts
import { defineConfig } from '@u1in/loom-core';

export default defineConfig({
  commonNotice: { file: 'partials/notice.md' },
  variables: { PROJECT_NAME: 'MyProject' },
});
```

```bash
npx loom build
# ✔ pr-review@1.0.0 → skills/pr-review
```

将源码放到 `src/skills/pr-review/SKILL.source.md`。frontmatter 中的 `name` 必须与目录名一致，`metadata.version` 必须是合法 SemVer：

```markdown
---
name: pr-review
description: Review changes for correctness and regressions.
metadata:
  version: 1.0.0
---

# PR Review

Inspect the changes in {{PROJECT_NAME}}.
```

## CLI

```bash
loom build                      # 构建全部 Skill
loom build --skill pr-review    # 只构建一个
loom build --out ./custom-dist  # 覆盖输出目录
loom build --check              # 只校验现有产物，不写盘
loom build --check-determinism  # 连续构建两次并比较哈希
loom --version
loom --help
```

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 构建失败（配置、插件、产物校验任一环节） |
| `2` | 参数解析错误 |

`--check-determinism` 会把两次构建分别输出到系统临时目录的两个子目录，比较「相对路径 + 内容哈希」的映射；不一致时报出差异文件列表并以 `1` 退出。该模式会跳过缓存读写，不影响 `.loom-cache`。

## 配置

单一入口 `loom.config.ts`（也接受 `.mts` / `.js` / `.mjs`），在 `process.cwd()` 下自动探测。相对路径统一以配置文件所在目录为基准。

| 字段 | 必填 | 说明 |
|---|---|---|
| `skills` | | 省略时发现 `src/skills/*/SKILL.source.md`；显式配置为非空 `{ name, source, entry? }[]`，`name` 唯一且匹配 `^[a-z0-9][a-z0-9-]*$` |
| `output` | | 输出目录，默认 `.`，产物位于 `skills/` |
| `commonNotice` | | 字符串、文件或其有序数组，文件可配置 `headingShift` |
| `variables` | | 自定义变量，键不可为 `name` / `skill` / `version` |
| `installDoc` | | 默认 `true`；`false` 关闭生成，也可传配置对象 |
| `injections.text` | | `{ id, position, skills?, content }[]`，`id` 唯一 |
| `injections.metadata` | | `{ skills?, path, value }[]`，`value` 必须可 JSON 序列化 |
| `plugins` | | `LoomPlugin` 实例数组 |
| `replacements` | | `{ search, replace, flags?, skills?, files? }[]` |

校验由 zod 完成，根对象与各配置项均为 `strict`——**未知字段直接报错**，配置拼写错误不会静默通过。`defineConfig` 同时支持同步配置、`Promise` 和返回二者的函数（异步配置为实验性能力）。

省略 `skills` 时，`loadConfig` 读取约定目录中的入口，并以子目录名作为 Skill 名，找不到入口时会报错。显式配置时，`entry` 默认读取 `SKILL.md`，源码目录缺失会在读取入口时失败。`injections`、`replacements` 和 `installDoc` 引用的 Skill 名必须出现在最终列表中。

`replacements.flags` 可设置为 `g`、`i`、`gi` 或 `ig`；设置后 `search` 按正则表达式解释。未设置时按普通字符串替换。

`injections.text` 的 `content` 可为字符串或 `{ file }`，支持 `top` / `bottom` 位置以及可选的 `skills` 范围；文本参与变量插值和替换。构建始终从源码生成，不为注入内容添加 HTML 注释。`injections.metadata` 将 JSON 值按点号路径写入 `metadata.loom.injections`，不进行插值或替换。

## 安装文档

Loom 默认在每个 Skill 的 `INSTALL.md` 中生成一句面向当前 harness 的中文安装指引。

- Loom 从 GitLab 或 GitHub 的 raw 发布地址推导安装链接，保留分支或标签以及 Skill 目录。`source` 可覆盖推导结果，支持 `{{name}}` 等变量。缺少安装来源时，文案提示从当前目录安装。配置了无法推导的 `baseUrl` 时，构建会告警。
- `file` 改输出文件名，必须是 Skill 根目录下的 `.md` 文件名。
- `template` 指定模板文件，`text` 直接内联模板，二者互斥。模板支持 `{{name}}`、`{{skill}}`、`{{version}}`、`{{description}}`、`{{source}}` 与 `variables`。未定义变量原样保留并告警。
- `skills` 限定生效范围。

生成的文档与其他 Markdown 一样参与 `baseUrl` 链接补全和 `--check`。源码或构建产物已有同名文件时跳过并告警。

## 构建管线

每个 Skill 的处理顺序是固定的：

```text
loadConfig（jiti 加载，失败时带上文件路径与原始错误）
  → validatePlugins
  → 注册内置 injections / install-doc → 逐个 await plugin.apply(api)
  → onBuildStart
  → for each skill:
      onSkillStart
      读取 SKILL.md（\r\n / \r 规范化为 \n）→ 解析 AST + frontmatter
      校验 name 与 metadata.version
      injectCommonNotice（metadata.loom.commonNotice === false 时跳过）
      [transforms，before-replace，按注册顺序]
      applyReplacements（含变量插值）
      [transforms，after-replace]
      [metadata transforms] → 每次执行后校验保留字段
      YAML 回写（lineWidth: 0，sortMapEntries: false）→ 序列化 Markdown
      复制资源文件（文本执行替换，二进制只复制，保留权限位）
      onEmitFiles
      Markdown 相对链接校验
      --check 比较哈希 / 否则写入 .<name>.tmp 后整体替换
      onSkillEnd
  → onBuildEnd
```

几个容易踩的细节：

- **内置 `injections` 先注册**，因此 `text(top)` 的插入位置在公共说明之后；第三方插件若也注册 `before-replace` 变换，内容排在配置注入之后。
- **`commonNotice` 插在正文首个标题之后**，`text(top)` 随后按声明顺序插入。无标题时从 frontmatter 后开始插入。没有公共说明时，`text(top)` 位于 frontmatter 后。不产生任何 HTML 注释标记。
- **替换只作用于 `text` / `inlineCode` / `code` 节点**与文本资源，不碰 `html` 节点；`files` 用 picomatch 匹配 Skill 内的相对路径（含点文件），文本资源的匹配路径是它在 Skill 目录下的相对路径。
- **`replace` 的值也会做变量插值**，但不会被后续规则再次替换。
- **未定义的 `{{VAR}}` 原样保留并告警**，不阻断构建。
- **`after-replace` 阶段注入的内容不参与替换**，适合写入必须逐字保留的文本。
- **资源写入先落到 `.tmp`**，替换前将旧目录移到备份位置，若新目录重命名失败则尝试恢复旧目录。切换期间目标路径可能短暂不存在，进程意外中断时可能留下备份目录。

## 变量插值

内置变量：`version`（当前 Skill 版本）、`name` 与 `skill`（Skill 名，二者等价）。自定义变量来自 `variables`。

语法为 `{{变量名}}`，区分大小写，变量名需匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。插值发生在公共说明、`injections.text`、正文文本节点、`replace` 的替换值，以及文本资源中。

## 保留字段

插件执行完 metadata transform 后，Loom 会序列化比较 `name`、`metadata.version`、`metadata.loom.commonNotice`，任一被修改即构建失败。`injections.metadata[].path` 同样禁止以这三个字段开头，也禁止 `__proto__` / `constructor` / `prototype` 段。

## 程序化 API

```ts
import { build, hashFiles, loadConfig, defineConfig, validatePlugins } from '@u1in/loom-core';

const config = await loadConfig();          // 返回已填充默认值的 LoadedConfig
await build(config, { skill: 'pr-review' });

const hashes = await hashFiles('dist');     // { 相对路径: sha256 }
```

`build(config, options)` 的选项：

| 选项 | 说明 |
|---|---|
| `skill` | 只构建指定 Skill，未匹配到时报错 |
| `out` | 覆盖输出目录（相对 `config.rootDir`） |
| `check` | 只校验现有产物，与期望哈希不一致时抛错 |
| `checkDeterminism` | 连续构建两次到临时目录并比较 |
| `reloadConfig` | 配合确定性检查使用，每次构建前重新加载配置 |
| `skipCache` | 跳过 `.loom-cache` 的读取与写入 |

也可以从子路径导入：`@u1in/loom-core/config`（`defineConfig`、`loadConfig`）与 `@u1in/loom-core/plugin`（`validatePlugins` 与插件相关类型）。

## PluginAPI

```ts
import type { LoomPlugin } from '@u1in/loom-core';

const plugin: LoomPlugin = {
  name: 'my-plugin',
  apply: (api) => {
    api.addTransform((tree, ctx) => tree);                      // 默认 before-replace
    api.addTransform((tree) => tree, { phase: 'after-replace' });
    api.addMetadataTransform((frontmatter, ctx) => frontmatter); // 拿到完整 frontmatter
    api.onEmitFiles((ctx) => ctx.emit('scripts/check.js', '...'));
    api.onBuildStart((ctx) => {});
    api.onSkillStart((ctx) => {});
    api.onSkillEnd((ctx) => {});
    api.onBuildEnd((ctx) => {});
  },
};
```

约束：

- `apply()` 只调用一次，插件应在此完成全部注册；抛错时错误信息带上插件名。
- 四个生命周期钩子事件式执行，按注册顺序串行 `await`，没有环绕语义；`onBuildEnd` 在构建失败时不执行。
- `emit()` 的路径必须是 Skill 内相对路径，绝对路径、盘符、含 `..` 的路径直接失败。
- 变换应为纯函数，除 `ctx.env` 的环境快照外不读取其他外部状态。
- 第三方插件无沙箱，运行在本机进程内。

`TransformContext` 提供 `skillName`、`version`、`variables`、`config`、`logger` 和 `interpolate(text)`；`SkillContext` 的 `tree` / `metadata` 是实时 getter，指向当前构建状态。`EmitContext` 同样以 getter 暴露 `metadata`（已完成 metadata transform 的 frontmatter），可据此读取 `description` 等字段。

### 插件类型与分发

`@u1in/loom-core` 和 `@u1in/loom-core/plugin` 导出 `LoomPlugin`、`PluginAPI`、`Transform`、`MetadataTransform`、`BuildContext`、`TransformContext`、`SkillContext`、`EmitContext` 与 `BuildEnv`。钩子可异步执行，按注册顺序串行调用。

独立插件应以 core 的兼容版本范围声明 `peerDependencies`；在本 workspace 开发时，同时用 `workspace:*` 声明 core 的开发依赖。插件应说明环境依赖及其对确定性的影响，并可用 [test-utils](../test-utils/README.md) 创建测试上下文和收集注册项。

## 错误与告警

| 场景 | 行为 |
|---|---|
| 找不到配置文件 | 失败，退出码 1 |
| 配置加载或校验失败 | 失败，错误含文件路径 / 字段路径 |
| 插件形状非法 | `validatePlugins` 抛错 |
| 插件 `apply` / transform / 钩子抛错 | 失败，错误含插件名、Skill 名与阶段 |
| 插件修改保留字段 | 失败，提示被修改字段 |
| `metadata.version` 非法 | 失败 |
| 产物 Markdown 相对链接断开 | 失败，报出文件与链接 |
| 源码变化但版本未变 | **仅告警**，退出码仍为 0 |
| 未定义变量 | 仅告警，占位符原样保留 |

这里的“源码变化”由 `.loom-cache/<skill>.json` 记录的源码哈希判断，缓存只用于这条告警，不参与增量构建。

## 确定性

相同源码、相同配置、相同 Loom 版本，产物逐字节一致。实现手段：不写时间戳与随机值、不保留 mtime、所有 glob 结果按路径排序、文本换行统一为 `\n`、`remark-stringify` 固定 `bullet: '-'` / `emphasis: '*'` / `fences: true`、`yaml.stringify` 固定 `lineWidth: 0` 与 `sortMapEntries: false`、替换与变换顺序写死、写入采用临时目录、备份和失败回滚。

确定性只覆盖核心与内置能力；配置里的随机值、时间戳，以及会读取环境的插件都可能破坏它，请用 `loom build --check-determinism` 在 CI 中兜底。

## 相关包

- [`@u1in/loom-plugin-preflight`](../plugin-preflight/README.md)：注入“使用前检查”章节与结构化 metadata
- [`@u1in/loom-plugin-env-probe`](../plugin-env-probe/README.md)：探测构建环境
- [`@u1in/loom-test-utils`](../test-utils/README.md)：插件测试辅助

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

### 自定义源码入口

每个 Skill 可使用 `entry` 指定源码目录内的 Markdown 文件名：

```ts
skills: [{ name: 'demo', source: 'src/skills/demo', entry: 'SKILL.source.md' }],
```

省略时读取 `SKILL.md`。入口文件不直接复制到产物，Loom 将处理后的内容写成标准的 `SKILL.md`。文件名不允许包含目录或路径穿越。

### Markdown 链接地址

设置 `baseUrl` 后，Skill 产物中 Markdown 文件的相对链接、图片和引用链接会解析为绝对地址：

```ts
baseUrl: 'https://example.com/skills/{{name}}/',
```

`baseUrl` 是每个 Skill 发布目录的 HTTP(S) 地址，可使用 `{{name}}` 等变量。子目录中的 Markdown 链接相对于该文件解析，查询参数和章节锚点保留。仅含 `#锚点` 的链接、带协议的地址以及以 `//` 开头的地址保持原样。根路径链接按网站根目录解析。未设置时保留原链接并继续检查本地相对链接。

链接转为绝对地址后，访问引用内容需要访问对应网站，包括链接到随 Skill 分发资源的情况。
