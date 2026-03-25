# WeClaw Agent

`weclaw-agent.ts` 是一个基于微信 iLink Bot SDK 的本地 Agent 示例。它负责把微信消息接入本地大模型，并在受控边界内调用文件、进程、长期记忆与上下文压缩能力。

当前工程已经整理为一个面向微信运行的 Node.js 项目，默认使用 `epiral/weixin-bot` 对应的官方 Node SDK `@pinixai/weixin-bot`。

## 依赖说明

本工程已经直接添加了该仓库的 Node SDK 依赖：

- 仓库：<https://github.com/epiral/weixin-bot>
- npm 包：`@pinixai/weixin-bot`

注意：当前 `@pinixai/weixin-bot` 发布包里缺少 `dist/` 产物，因此本工程会在 `postinstall` 阶段自动检查并本地构建该 SDK，确保类型声明和运行入口可用。

换句话说，这个仓库现在就是一个直接面向微信入口运行的 Agent 工程。

## 项目结构

```text
.
├─ src/
│  ├─ agent-config.json
│  ├─ bot-adapter.ts
│  └─ weclaw-agent.ts
├─ scripts/
│  └─ repair-weixin-bot.mjs
├─ dist/
├─ package.json
└─ README.md
```

- `src/weclaw-agent.ts`：Agent 主入口，负责模型调用、工具执行、上下文与长期记忆
- `src/bot-adapter.ts`：微信 SDK 适配层，统一登录、收消息、回复、typing
- `src/agent-config.json`：默认运行配置
- `scripts/repair-weixin-bot.mjs`：修复官方 SDK 发布包缺少 `dist/` 的问题

## 作用

`weclaw-agent.ts` 做了几件事：

1. 通过 `WeixinBot` 登录微信并持续接收消息。
2. 把用户消息发送给大模型进行理解和决策。
3. 根据模型输出，决定是直接回复，还是调用本地 skills。
4. 在配置允许的范围内访问文件、执行受限进程、写入长期记忆。
5. 保存短期上下文，并按周期调用大模型压缩上下文，只保留关键事实、偏好和任务状态。

它本质上是一个“微信入口 + 模型推理 + 本地工具执行 + 记忆管理”的最小可运行 Agent。

## 能力

当前示例内置了这些能力：

- `list_files`：列出允许目录下的文件和目录
- `read_file`：读取允许范围内的文本文件
- `write_file`：写入允许后缀的文本文件
- `run_process`：执行白名单里的本地命令
- `remember_note`：写入长期记忆

这些能力不是完全开放的，是否启用、能访问什么目录、能执行什么命令，全部由配置文件控制。

## 运行

需要准备：

1. Node.js 22+
2. 智谱 API Key
3. 微信 iLink Bot 可用登录环境

下面所有命令都默认在项目根目录执行。

先安装依赖：

```bat
npm install
```

启动微信 Agent：

```bat
set ZHIPU_API_KEY=你的智谱APIKey
npm run dev
```

首次运行时，`@pinixai/weixin-bot` 会走扫码登录流程；成功后凭证默认保存在用户目录下的 `.weixin-bot/credentials.json`。

如果你想覆盖 SDK 参数，可选环境变量如下：

```bat
set WECLAW_WEIXIN_BASE_URL=https://ilinkai.weixin.qq.com
set WECLAW_WEIXIN_TOKEN_PATH=自定义凭证文件路径
set WECLAW_WEIXIN_FORCE_LOGIN=1
```

如果要运行编译后的版本：

```bat
npm run build
npm start
```

如果你希望从其他位置加载配置文件，可以设置：

```bat
set AGENT_CONFIG_PATH=./config/agent-config.json
```

## 配置

默认配置文件是 [src/agent-config.json](src/agent-config.json)。如果通过 `AGENT_CONFIG_PATH` 覆盖，建议也使用相对项目根目录的路径。

## 启动流程

1. 安装依赖并设置 `ZHIPU_API_KEY`
2. 执行 `npm run dev`
3. 首次扫码登录微信
4. Agent 开始长轮询收消息并自动回复

### `model`

控制模型调用参数。

```json
"model": {
  "name": "glm-4-flash",
  "temperature": 0.2
}
```

字段说明：

- `name`：使用的大模型名称
- `temperature`：采样温度

### `agent`

控制 Agent 推理行为。

```json
"agent": {
  "systemPrompt": "...",
  "maxHistoryMessages": 12,
  "maxToolSteps": 6
}
```

字段说明：

- `systemPrompt`：系统提示词
- `maxHistoryMessages`：短期上下文最多保留多少条消息
- `maxToolSteps`：单次请求里最多允许模型连续调用多少步工具

### `permissions`

控制本地访问边界。

```json
"permissions": {
  "enabledSkills": ["list_files", "read_file", "write_file", "run_process", "remember_note"],
  "allowedRoots": ["."],
  "maxFileBytes": 65536,
  "writableExtensions": [".md", ".txt", ".json", ".ts", ".js", ".py", ".yaml", ".yml"]
}
```

字段说明：

- `enabledSkills`：启用哪些 skills，不在列表里的能力即使代码存在也不会暴露给模型
- `allowedRoots`：允许访问的根目录列表，文件读写都必须落在这些目录下
- `maxFileBytes`：单次允许读取的最大文件大小
- `writableExtensions`：允许写入的文件后缀

### `memory`

控制长期记忆与上下文压缩。

```json
"memory": {
  "enabled": true,
  "directory": ".agent-data/memory",
  "contextDirectory": ".agent-data/context",
  "categories": ["profileNotes", "preferences", "activeTasks"],
  "maxItemsPerCategory": 12,
  "compressionIntervalTurns": 8,
  "compressionKeepRecentMessages": 4
}
```

字段说明：

- `enabled`：是否启用长期记忆
- `directory`：长期记忆保存目录
- `contextDirectory`：短期上下文状态保存目录
- `categories`：允许写入的长期记忆分类
- `maxItemsPerCategory`：每类长期记忆最多保留多少条
- `compressionIntervalTurns`：累计多少轮对话后触发一次上下文压缩
- `compressionKeepRecentMessages`：压缩后短期上下文还保留最近多少条消息

### `process`

控制允许执行的本地命令白名单。

```json
"process": {
  "commands": {
    "git_status": {
      "description": "Show short git status",
      "command": "git",
      "args": ["status", "--short"],
      "cwd": ".",
      "timeoutMs": 15000
    }
  }
}
```

字段说明：

- `commands`：允许执行的命令集合
- 每个命令项包含：
  - `description`：给模型看的描述
  - `command`：实际执行的程序
  - `args`：固定参数列表
  - `cwd`：执行目录
  - `timeoutMs`：超时时间

这里的设计重点是“白名单命令”，而不是让模型任意执行 shell。

## 数据目录

默认会在项目根目录下的 `.agent-data/` 生成两类数据：

- `memory/`：长期记忆
- `context/`：短期上下文状态

这样即使进程重启，也可以恢复部分上下文和长期信息。

## 安全边界

这个示例的安全边界主要靠配置控制：

- 不在 `enabledSkills` 里的能力不可调用
- 不在 `allowedRoots` 里的路径不可访问
- 不在 `writableExtensions` 里的后缀不可写入
- 不在 `process.commands` 白名单里的命令不可执行
- 长期记忆可整体关闭

因此，真正的权限策略不在 prompt 里，而在本地配置文件里。

## 适合的使用方式

这份示例适合用于：

- 把微信接成自建 Agent 的入口
- 验证本地 skills 与模型协同调用
- 验证长期记忆和上下文压缩策略
- 在受控范围内访问宿主机文件与命令

如果后续要进一步产品化，建议继续补充：

1. 高风险命令的二次确认
2. 更细粒度的目录和命令权限分层
3. 更稳定的结构化 tool calling 协议
4. 记忆压缩结果的人工审计或回滚机制
