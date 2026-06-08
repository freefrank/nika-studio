# 审计报告

日期：2026-06-08

## 审计结论

1. **Critical：核心持久化链路是坏的。**

   多个主流程会在写入 IndexedDB 时抛 `DataCloneError`，导致“看起来成功、实际没保存”。根因是把 Vue 响应式对象直接传给 `IDBObjectStore.put()`。

   代表路径：

   - `src/views/EditorView.vue:87` -> `src/stores/characterStore.ts:20` -> `src/services/characterService.ts:25`
   - `src/components/ApiConfigPanel.vue:38` -> `src/stores/apiConfigStore.ts:30`
   - `src/views/ChatView.vue:104` -> `src/services/chatService.ts:30`
   - `src/views/AgentView.vue:223` -> `src/services/agentService.ts:27`

   浏览器中已实际复现 4 条路径：新建角色保存失败、API 配置保存失败、聊天消息不落盘、Agent 本地命令历史不落盘。这是发布阻断级问题。

2. **High：部署目标需要修正为公开 HTTP 静态服务设计。**

   README 当前写着“直接打开 `dist/index.html` 即可离线使用”，但这不应作为正式需求。正式设计应改为：构建产物通过公开 HTTP/HTTPS 静态服务器托管 `dist/`，不承诺 `file://` 直接打开。

   已验证旧说明不成立：直接打开 `file:///C:/Users/freefrank/Desktop/nika-studio/dist/index.html` 时，资源请求落到 `file:///C:/assets/...`，页面空白。`src/style.css:1` 还依赖 Google Fonts，也不符合离线运行目标。

   修正后的结论是：这不是运行时必须支持的离线模式，而是 README/部署设计需要修正。应明确使用 `npm run preview` 或 Nginx/Caddy/Node 静态服务通过 HTTP 提供 `dist/`。

3. **High：Agent 会自动执行模型返回的 `json:patch`，没有确认、没有 schema 校验、没有快照/回滚。**

   解析与应用在 `src/views/AgentView.vue:182`，自动保存在 `src/views/AgentView.vue:248`。这意味着一次模型误改会直接污染角色卡；README 里把 Agent 定位成编辑器，这个风险不该留到运行时再碰。

4. **Medium：模型生成的 HTML 会在 `iframe srcdoc` 中以 `sandbox="allow-scripts"` 执行。**

   位置在 `src/views/AgentView.vue:255` 和 `src/views/EditorView.vue:494`。它拿不到父页面同源权限，但仍可跑脚本、发网络请求、占资源；这至少需要更强约束或显式用户确认。

5. **Medium：PNG 导出实现不符合 PNG 规范。**

   `tEXt` chunk 的 CRC 被直接写成 `0`，见 `src/services/cardIO.ts:68`。有些消费端会忽略，但严格一点的解析器会把文件视为损坏，这和 README 里宣称的 SillyTavern 兼容性不匹配。

6. **Medium：聊天“重新生成”逻辑会错误裁剪历史。**

   问题在 `src/views/ChatView.vue:122`：同一数组被连续按旧索引裁两次，容易造成顺序错乱或上下文丢失。这个结论也和 TODO 里已知问题相互印证。

7. **Medium：小说导入的编码自动检测算法不可靠。**

   `src/views/NovelView.vue:56` 当前是“哪个解码后字符串更短就选哪个编码”，这不是有效判据，误判后会把后续章节识别和世界书抽取全部带偏。

## 开放问题 / 假设

- 没有接入真实外部模型账号，所以 API 供应商联调、SSE 兼容性、限流行为没有实测；相关结论主要来自代码审计和本地无 Key 分支。
- 部署目标已修正为公开 HTTP/HTTPS 静态服务，不再把 `file://` 直接打开作为正式运行需求。
- `package.json:6` 只有 `dev`、`build`、`preview`，没有 lint、单测或 e2e 回归门禁。这也是为什么上述持久化问题能在构建通过的情况下直接进入 UI。

## 审计范围

本次没有改业务代码，只做了文档阅读、代码审计、构建校验和浏览器冒烟测试。

验证结果：

- `npm run build` 通过。
- `npm audit` 和 `npm audit --omit=dev` 都是 0 vulnerabilities。
- 浏览器测试覆盖了 `http://127.0.0.1:4173/` 的主流程。
- `file:///C:/Users/freefrank/Desktop/nika-studio/dist/index.html` 仅用于验证旧 README 的离线打开说明不成立；修正后的正式目标是 HTTP 静态服务部署。

## 建议优先级

建议优先修 1-3，再补最小浏览器回归用例，至少覆盖：

- 新建角色保存
- API 配置保存
- 聊天消息持久化
- Agent 本地命令历史持久化
- 生产构建产物通过 HTTP 静态服务访问
