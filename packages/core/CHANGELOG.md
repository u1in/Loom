# @u1in/loom-core

## 0.4.0

### Minor Changes

- b4b3b2c: 构建时默认生成 `INSTALL.md`，可通过 `installDoc: false` 关闭。
- 03fbfd3: 省略 `skills` 配置时，自动发现 `src/skills/*/SKILL.source.md`，按子目录名构建到默认的 `skills/` 目录。
- 8307e65: 新增 `exclude` 配置，复制 Skill 资源和计算源码哈希时排除匹配的开发文件。
- 7575c38: 移除 Loom 配置的 `version` 字段，直接使用配置项定义构建行为。
- b2c217d: 新增 `skillsPath` 配置，通过 glob 发现工作区或其他目录中的 Skill 入口。
- d8a2445: 新增 `installDoc` 配置，按 Skill 生成面向当前 harness 的一句话安装指引。安装来源可从 GitHub 或 GitLab 的发布地址推导，保留分支和目录，支持显式指定来源及覆盖模板。

## 0.3.0

### Minor Changes

- 公共说明标题默认根据 Skill 的首个标题自动对齐。
- 支持为各 Skill 指定源码入口文件。
- 支持通过 baseUrl 将 Markdown 相对链接转换为绝对地址。
- 公共说明默认插在 Skill 的第一个标题之后。
- 默认将产物写入仓库根目录的 skills，并阻止源码与产物目录重叠。

## 0.2.0

### Minor Changes

- 支持按顺序批量织入公共说明、调整标题层级以及插值链接目标。

## 0.1.0

### Minor Changes

- 首次发布 Skill AST 构建管线、TypeScript 配置、CLI 和插件 API。
- 支持公共说明、文本及 metadata 注入、变量插值、资源替换、产物校验和确定性检查。
- 支持暂存产物，并在替换失败时尝试恢复旧产物。
