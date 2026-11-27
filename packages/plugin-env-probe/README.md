# @u1in/loom-plugin-env-probe

探测构建环境——Node 版本、平台、若干工具的版本、若干环境变量是否存在——并按配置打印、写入 metadata 或发射 JSON 文件。

它的用途有两个：给 Skill 产物附上“构建于什么环境”的线索；作为反面教材，演示**读取环境会破坏确定性**。

```bash
pnpm add -D @u1in/loom-plugin-env-probe
```

## 用法

```ts
// loom.config.ts
import { defineConfig } from '@u1in/loom-core';
import envProbe from '@u1in/loom-plugin-env-probe';

export default defineConfig({
  skills: [{ name: 'pr-review', source: 'src/skills/pr-review' }],
  plugins: [
    envProbe({
      mode: 'print',
      probe: {
        nodeVersion: true,
        platform: true,
        tools: ['git', 'docker'],
        env: ['GITHUB_TOKEN'],
      },
    }),
  ],
});
```

## 选项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `mode` | `'print'` | `'print'` / `'metadata'` / `'file'` |
| `output` | `'.loom-env.json'` | `mode: 'file'` 时的 Skill 内相对输出路径 |
| `probe.nodeVersion` | 关闭 | 采集 `process.version` |
| `probe.platform` | 关闭 | 采集 `process.platform` |
| `probe.tools` | 关闭 | 逐个执行 `<tool> --version`，取输出首行 |
| `probe.env` | 关闭 | 记录环境变量**是否存在**（布尔值，不记录值） |

`probe` 内所有开关默认关闭，不配置就只会得到一个空快照。

## 三种模式

| 模式 | 行为 | 确定性 |
|---|---|---|
| `print` | 在 `onBuildStart` 打印一次 `Environment: {...}`，产物不变 | ✅ 不影响 |
| `metadata` | 写入每个 Skill 的 `metadata.loom.env` | ❌ **破坏确定性** |
| `file` | 向每个 Skill 发射 `output` 指定的 JSON 文件 | ❌ **破坏确定性** |

`print` 模式可以直接用于排查「为什么在 CI 上构建失败」，因为它不会让产物在不同机器上产生差异。

`metadata` 模式产物形如：

```yaml
metadata:
  version: 1.0.0
  loom:
    env:
      nodeVersion: v20.11.0
      platform: darwin
      tools:
        git: git version 2.43.0
        docker: null
```

`file` 模式会为**每个** Skill 写一份同样的快照，内容是 `JSON.stringify(snapshot, null, 2) + '\n'`。

## 探测细节

- 工具版本通过 `execFileSync(tool, ['--version'])` 获取，超时 3 秒；命令不存在或执行失败记为 `null`，不中断构建。
- 只取输出的第一行。
- 环境变量只输出布尔值，因此不会把密钥写进产物；如果确实需要值，请自己写插件。
- 工具探测是同步子进程调用，每个 Skill 构建都会重跑一次，工具多时会有可感知的开销。

## 确定性警告

`metadata` 与 `file` 模式把构建机信息写进产物，**同一份源码在不同机器或不同 Node 版本上构建，目录哈希会不同**。`npx skills` 依据目录哈希判断更新，这会导致它误判为新版本。

因此：

- 需要可复现产物时只用 `print`。
- 在 CI 上跑 `loom build --check-determinism` 时不要同时启用 `metadata` / `file` 模式，否则检查必然失败——这属于预期行为，不是 Loom 的缺陷。
- 如果确实要发布带环境信息的产物，请在项目 README 中声明这是有意为之。
