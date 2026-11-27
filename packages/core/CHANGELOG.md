# @u1in/loom-core

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
