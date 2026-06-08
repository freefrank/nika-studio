# 开发计划

> 版本：v0.3.1  
> 最后更新：2026-06-08

## 当前状态

项目主体功能已经完成，并已根据 [AUDIT.md](./AUDIT.md) 的审计结论完成 P0 / P1 修复。

现阶段优先级是：

1. 把已完成的手动浏览器回归固化为自动化用例。
2. 增加基础 lint / test 质量门禁。
3. 接入真实 API 供应商做联调验证。

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

- 目前只有手动浏览器冒烟回归，尚未固化为自动化 e2e。
- `package.json` 仍缺少 lint、单测或 e2e 质量门禁。
- 外部模型账号、SSE 兼容性、供应商限流行为尚未实测。

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
| v0.2.1-audit-fix | 2026-06-08 | 根据审计结果转入稳定性、安全性、部署修正阶段 |
| v0.3.0 | 2026-06-08 | 全站 UI/UX 视觉重构与毛玻璃美化，优化移动端与输入框布局 |
| v0.3.1 | 2026-06-08 | 在 UI 右下角新增精致的版本号徽章，并实现 package.json 动态版本号导入 |
