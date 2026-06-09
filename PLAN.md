# 开发计划

> 版本：v0.3.1  
> 最后更新：2026-06-08

## 当前状态

项目主体功能已经完成，并已根据 [AUDIT.md](./AUDIT.md) 的审计结论完成 P0 / P1 修复。

现阶段优先级是：

1. 优化 NovelView `txt转世界书` 的上下文管理，降低长篇处理时的输入 token 膨胀。
2. 把已完成的手动浏览器回归固化为自动化用例。
3. 增加基础 lint / test 质量门禁。
4. 接入真实 API 供应商做联调验证。

当前正式部署目标：

- 生产环境通过 **HTTP / HTTPS 静态服务** 托管 `dist/`
- 不再把 `file://` 直接打开作为正式运行方式
- 前端继续使用 Hash Router，适配静态托管

已完成修复：

- IndexedDB 写入前统一转换为 plain object，修复角色、API 配置、聊天、Agent 历史持久化失败。
- Agent `json:patch` 增加 schema 校验、修改摘要确认、应用前快照和失败中止。
- HTML 预览默认移除脚本执行权限，并对 Agent HTML 预览做净化和长度限制。
- README 部署说明改为 HTTP/HTTPS 静态服务设计。
- 修复 ChatView `regenerate` 历史裁剪、PNG `tEXt` chunk CRC、NovelView 编码自动检测。

剩余发布风险：

- `txt转世界书` 当前每个分片都会回灌完整累计世界书，长篇小说会导致输入 token 持续增长，缓存命中和成本控制都不理想。
- 目前只有手动浏览器冒烟回归，尚未固化为自动化 e2e。
- `package.json` 仍缺少 lint、单测或 e2e 质量门禁。
- 外部模型账号、SSE 兼容性、供应商限流行为尚未实测。

## 下一里程碑：NovelView 上下文管理优化

目标：**把小说分片处理从“完整历史回灌”改为“相关记忆检索 + 增量 patch 输出”**，让长篇 `txt转世界书` 的输入 token 随章节增长保持可控。

### 背景问题

当前 `buildPrompt()` 会在每个分片请求中包含：

```text
固定说明 + JSON 模板 + 上一分片尾部 + 当前分片 + 完整 localGeneratedWorldbook
```

其中完整 `localGeneratedWorldbook` 会随着处理进度持续变大。后续每个分片都重新发送完整世界书，导致：

- 输入 token 接近随进度线性增长，整本书总成本接近二次增长。
- OpenAI-compatible 上游即使有 prompt cache，也只能对重复前缀或服务端实现命中，应用侧不可控。
- `/responses` 的 `previous_response_id` 可以减少客户端重复传输，但不能替代业务侧裁剪；如果把所有历史都挂在同一会话里，上下文仍会越来越大。
- JSON 修复 prompt 会在异常时再次发送大段模型输出，进一步放大成本。

### Phase A：应用侧上下文裁剪（优先）

实现 `buildRelevantMemory(seg, localGeneratedWorldbook)`，替代直接 `JSON.stringify(localGeneratedWorldbook, null, 2)`。

规则：

- 当前分片只带命中当前文本的相关条目。
- 命中依据优先使用条目名、关键词、常见别名；必要时再做分类兜底。
- 相关记忆必须有硬上限，例如字符数或估算 token 上限。
- 始终保留一个短全局索引，用于告诉模型已知条目列表，但不展开全部内容。
- 未命中的条目由本地合并逻辑保留，不要求模型记住完整历史。

交付标准：

- 单次分片 prompt 不再随完整世界书线性增长。
- UI 中能看到当前分片带入的相关条目数量和估算上下文长度。
- 长篇处理时，连续 3 个后续分片的输入长度应稳定在同一数量级。

### Phase B：增量 patch 输出

把模型输出从“完整条目正文”收敛为增量变更：

```json
{
  "新增": {},
  "更新": {},
  "追加事实": {},
  "关键词补充": {}
}
```

规则：

- 模型只输出本次分片发现的新信息。
- 既有条目的完整合并由本地执行。
- 角色、地点、组织等结构化内容优先做字段级合并。
- 对剧情大纲可采用阶段追加，不要求每次重写完整大纲。

交付标准：

- 输出 token 明显下降。
- 相同角色跨章节补充信息不会丢失。
- JSON 修复仍能处理新 patch schema。

### Phase C：OpenAI-compatible `/responses` 适配（可选增强）

在 API 层新增 Responses API 调用模式，用于兼容支持 `/responses` 的 OpenAI-compatible 端口。

使用边界：

- 不把整本小说处理放进一个无限延续的 server-side conversation。
- 可以按分片、批次或任务阶段使用 `previous_response_id`。
- 必须保存 `response.id`，并允许失败后回退到无状态请求。
- 仍以应用侧相关记忆裁剪为主，不依赖 provider 自动缓存保证成本。

交付标准：

- `Chat Completions` 与 `Responses API` 可在设置中切换。
- 支持流式解析 Responses API 输出。
- 能记录 usage 中的 input/output/cached token 字段；如果上游不返回 cached token，也能正常运行。

### Phase D：观测与成本反馈

增加每个分片的轻量统计：

- prompt 字符数 / 估算 token
- response 字符数 / 估算 token
- 相关记忆条目数
- JSON 修复次数
- 供应商返回的 usage 信息（如有）

交付标准：

- NovelView 进度区展示当前分片的上下文规模。
- 保存到进度状态，便于中断恢复后继续观察。
- 可以导出一次处理任务的统计摘要。

## 下一里程碑：v0.2.1

目标：**先把现有功能修到“可保存、可回归、可部署”**

### Phase 1：发布阻断修复（已完成）

#### 1. IndexedDB 持久化修复

问题来源：`AUDIT.md` 第 1 条，多个主流程写入 IndexedDB 时会触发 `DataCloneError`。

涉及模块：

```text
src/services/characterService.ts
src/services/chatService.ts
src/services/agentService.ts
src/stores/characterStore.ts
src/stores/apiConfigStore.ts
src/views/EditorView.vue
src/views/ChatView.vue
src/views/AgentView.vue
src/components/ApiConfigPanel.vue
```

实现要求：

- 所有写入 IndexedDB 的对象必须先转换为 plain object
- 不直接把 Vue 响应式对象传入 `put()`
- service 层负责写入前 clone，不污染调用方状态
- 保存失败时 UI 必须给出明确提示

交付标准：

- 新建角色后刷新仍存在
- API 配置保存后刷新仍存在
- 聊天消息刷新后仍存在
- Agent 本地命令历史刷新后仍存在

状态：已完成，并通过一次浏览器手动回归验证。

#### 2. ChatView `regenerate` 逻辑修复

问题来源：`AUDIT.md` 第 6 条。

修复目标：

- 明确“重新生成”的消息裁剪规则
- 避免同一数组基于旧索引连续变换
- 保证消息顺序稳定

状态：已完成。

#### 3. PNG 导出规范修复

问题来源：`AUDIT.md` 第 5 条。

修复目标：

- 正确计算 PNG `tEXt` chunk 的 CRC32
- 导出结果符合标准 PNG 规范
- 保持 SillyTavern 兼容性

状态：已完成。

---

### Phase 2：安全与部署修正（已完成）

#### 1. Agent patch 执行加防护

问题来源：`AUDIT.md` 第 3 条。

目标：

- `json:patch` 执行前展示修改摘要
- 增加字段白名单和 schema 校验
- patch 应用前保存快照
- patch 失败时终止并提示

建议新增：

```text
src/services/historyService.ts
```

状态：已完成。

#### 2. HTML 预览收紧

问题来源：`AUDIT.md` 第 4 条。

目标：

- 重新评估 `sandbox="allow-scripts"` 是否必须
- 默认只做静态预览
- 如保留脚本执行，需显式用户确认
- 限制 HTML 预览长度和异常资源占用

状态：已完成；当前默认不授予 iframe 脚本执行权限。

#### 3. 部署与文档修正

问题来源：`AUDIT.md` 第 2 条。

目标：

- README 删除 `file://` 直接打开说明
- 明确开发、预览、生产托管方式
- 正式部署以 HTTP/HTTPS 静态服务为准
- 说明缓存策略和基础安全响应头要求

状态：已完成。

---

### Phase 3：最小回归能力（待固化）

当前 `package.json` 只有：

```text
dev / build / preview
```

缺少 lint、单测、e2e，是本次问题直接进入 UI 的原因之一。

本阶段目标：

- 增加最小浏览器回归用例
- 覆盖核心持久化路径
- 让后续修复有可重复验证手段

当前状态：已完成一次手动浏览器冒烟回归；尚未形成自动化脚本。

最低覆盖范围：

1. 创建角色并刷新验证
2. 保存 API 配置并刷新验证
3. 发送聊天消息并刷新验证
4. Agent 本地命令并刷新验证
5. 构建产物通过 HTTP 静态服务访问

---

### Phase 4：恢复功能迭代（中优先级，后续）

在 v0.2.1 稳定后，再继续之前计划中的增强项：

- Agent 快照回滚面板
- ChatView 多会话
- NovelView 分类持久化
- 模型列表缓存
- 世界书批量操作
- 聊天导出

## 架构约定

| 规则 | 说明 |
|------|------|
| 持久化边界 | 所有 IndexedDB 写入都必须在 `services` 层完成，且写入前转成 plain object |
| 视图职责 | `views` 不直接操作 IndexedDB，不直接承担数据结构修复 |
| Patch 安全 | Agent patch 默认不直接静默落盘，必须经过校验和快照 |
| 预览隔离 | 模型生成的 HTML 预览默认按不可信内容处理 |
| 部署目标 | 正式环境通过 HTTP/HTTPS 静态服务托管 `dist/` |
| 构建验证 | 每次修改后至少运行 `npm run build` |
| 回归验证 | 涉及持久化、导出、Agent 的修改必须补最小回归验证 |

## 版本记录

| 版本 | 日期 | 内容 |
|------|------|------|
| v0.1.0 | 2026-06-08 | 项目骨架：Vue 3 + Vite + TypeScript + Tailwind |
| v0.2.0 | 2026-06-08 | 主要功能完成：Editor / Chat / Agent / Novel / Settings |
| v0.3.0 | 2026-06-08 | 全站 UI/UX 视觉重构与毛玻璃美化，优化移动端与输入框布局 |
| v0.3.1 | 2026-06-08 | 在 UI 右下角新增精致的版本号徽章，并实现 package.json 动态版本号导入 |
| v0.3.2 | 2026-06-08 | 重构 NovelView，对齐原版小说转世界书算法与选项，实现 JSON 智能修复与 IndexedDB 进度自动存档恢复，并在界面中展示每个章节的详细总结状态 mark |
