# @u1in/loom-plugin-install-doc

Loom 的官方安装文档插件，支持为各 Skill 生成 `INSTALL.md`。

使用 Loom Core 0.5 时，`installDoc: true` 或省略该配置均会自动启用插件。要将插件显式加入 `plugins`，先安装：

```bash
pnpm add -D @u1in/loom-plugin-install-doc
```

```ts
import { defineConfig } from '@u1in/loom-core';
import { installDoc } from '@u1in/loom-plugin-install-doc';

export default defineConfig({
  plugins: [installDoc({ file: 'SETUP.md' })],
});
```

显式插件优先于自动注册。插件选项与 Core 的 `installDoc` 配置对象一致，包含 `file`、`source`、`template`、`text` 和 `skills`。

未指定 `source` 时，插件从 GitHub 或 GitLab 的 raw `baseUrl` 推导安装地址，并保留分支和目录。模板支持 `{{name}}`、`{{skill}}`、`{{version}}`、`{{description}}`、`{{source}}` 和配置的自定义变量。`template` 与 `text` 二选一。
