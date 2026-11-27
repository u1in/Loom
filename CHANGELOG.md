# Changelog

## 0.5.0

- 发布独立的官方安装文档插件 @u1in/loom-plugin-install-doc 0.1.0。Core 自动注册或显式注册均使用该包。
- 退役三个测试用子包。端到端示例改用本地自定义插件。

## 0.4.0

- 支持按目录约定或 skillsPath glob 发现 Skill，也可显式列出源码入口。
- 默认生成一句话安装指引，并从 GitHub 或 GitLab 发布地址推导安装链接。
- 支持使用 exclude 过滤开发文件。配置文件直接声明构建选项。

## 0.1.0

- 首次发布 Loom Skill 预编译框架，包括核心构建管线、CLI、插件 API 和内置注入。
- 提供 preflight、env-probe 官方插件及插件测试工具。
- 提供 TypeScript 配置、示例项目和确定性构建检查。
