# TODO

> 最后更新：2026-06-08

## 当前目标

以 [AUDIT.md](./AUDIT.md) 为准，已完成发布阻断与高风险修复；下一步优先优化 `txt转世界书` 的上下文管理，再把手动验证固化为可重复回归门禁。

---

## P0：NovelView 上下文管理优化

- [ ] **替换完整世界书回灌**
  - 范围：`src/views/NovelView.vue`
  - 当前问题：`buildPrompt()` 每个分片都会发送完整 `localGeneratedWorldbook`
  - 目标：改为只发送当前分片相关记忆
  - 验收：后续分片 prompt 长度不再随完整世界书线性增长

- [ ] **实现 `buildRelevantMemory()`**
  - 输入：当前分片文本、累计世界书
  - 输出：命中当前分片的相关条目、短全局索引、裁剪统计
  - 命中依据：条目名、关键词、别名、分类兜底
  - 验收：同一角色/地点再次出现时能带入对应旧条目

- [ ] **为相关记忆设置硬上限**
  - 建议先按字符数控制，再逐步加入 token 估算
  - 超限时优先保留当前分片命中项，其次保留最近更新项
  - 验收：极大世界书下单次请求仍保持可控输入规模

- [ ] **把模型输出改为增量 patch schema**
  - 输出新增条目、更新字段、追加事实、关键词补充
  - 不要求模型每次返回完整条目正文
  - 验收：输出 token 下降，跨章节信息仍能合并到同一条目

- [ ] **改造本地合并逻辑适配 patch**
  - 范围：`mergeWorldbookDataIncremental` / `mergeStructuredCharacterStrings`
  - 目标：由本地负责完整世界书状态，不把完整状态交给模型维护
  - 验收：角色、地点、组织、剧情大纲均可增量补充

- [ ] **压缩 JSON 修复 prompt**
  - 当前问题：格式修复失败时会再次发送大段错误 JSON 和完整结构说明
  - 目标：只发送必要 schema 和错误片段，避免二次 token 放大
  - 验收：格式修复请求的输入长度明显小于主请求

- [ ] **增加分片上下文统计**
  - 统计 prompt 字符数、response 字符数、相关记忆条目数、JSON 修复次数
  - 如上游返回 usage，则记录 input/output/cached token
  - 验收：UI 能看到每个分片的上下文规模

- [ ] **评估 OpenAI-compatible `/responses` 模式**
  - 范围：`src/services/apiService.ts` 与设置 UI
  - 支持 `previous_response_id` / `store` / 流式 output delta
  - 不用一个无限延续的 conversation 处理整本小说
  - 验收：支持 `/responses` 的端口可切换；不支持时能回退到 Chat Completions

- [ ] **新增长篇 token 回归样例**
  - 构造多分片假小说和累计世界书
  - 验收：第 N 个分片的 prompt 大小保持在固定上限附近，而不是持续增长

## P1：发布阻断

- [x] **修复角色保存 DataCloneError**
  - 范围：`characterStore` / `characterService` / `EditorView`
  - 验收：新建角色后刷新仍存在

- [x] **修复 API 配置保存 DataCloneError**
  - 范围：`apiConfigStore` / `ApiConfigPanel`
  - 验收：配置保存后刷新仍存在

- [x] **修复聊天消息持久化 DataCloneError**
  - 范围：`chatService` / `ChatView`
  - 验收：发送消息后刷新仍存在

- [x] **修复 Agent 历史持久化 DataCloneError**
  - 范围：`agentService` / `AgentView`
  - 验收：发送本地命令后刷新仍存在

- [x] **统一 IndexedDB 写入前 plain object 转换**
  - 范围：所有 `services/*Service.ts`
  - 验收：不再把 Vue 响应式对象直接传给 `IDBObjectStore.put()`

---

## P2：高优先级修复

- [x] **修正 README 部署说明**
  - 删除 `file://` 直接打开的正式承诺
  - 改为 HTTP/HTTPS 静态服务部署说明

- [x] **Agent patch 增加 schema 校验**
  - 限制允许修改的字段
  - 非法 patch 不执行

- [x] **Agent patch 执行前保存快照**
  - 新增 `historyService`
  - 为后续回滚做准备

- [x] **Agent patch 执行前展示修改摘要或确认**
  - 至少避免模型输出被静默自动落盘

- [x] **收紧 HTML 预览权限**
  - 重新评估 `allow-scripts`
  - 默认把模型生成 HTML 视为不可信内容

- [x] **修复 ChatView `regenerate` 消息裁剪逻辑**
  - 避免顺序错乱
  - 避免旧索引连续裁剪

- [x] **修复 PNG 导出 CRC**
  - `tEXt` chunk 使用正确 CRC32

- [x] **修复 NovelView 编码自动检测算法**
  - 不再使用“字符串更短”作为判据

---

## P3：最小回归验证

- [x] **完成一次手动持久化冒烟回归**
  - 创建角色并刷新验证
  - API 配置保存并刷新验证
  - 聊天消息持久化并刷新验证
  - Agent 本地命令历史并刷新验证

- [x] **完成生产构建 HTTP 访问验证**
  - 构建产物通过 HTTP 静态服务访问

- [ ] **固化为自动化浏览器回归用例**
  - 把上述持久化和 HTTP 访问验证纳入可重复执行脚本

- [ ] **增加基础 lint / 测试脚本**
  - 至少补一条可执行的质量门禁

---

## P4：稳定后继续

- [ ] **Agent 快照回滚面板**
- [ ] **ChatView 多会话**
- [x] **NovelView 分类及进度自动存档恢复**
- [ ] **模型列表缓存**
- [ ] **世界书批量操作**
- [ ] **聊天导出**
- [x] **移动端适配优化**

---

## 已知问题

- [x] **AgentView `/peek` 响应已支持 Markdown 渲染与美化代码块**
- [ ] `txt转世界书` 长篇处理时完整世界书反复回灌，导致输入 token 持续膨胀
- [ ] EditorView 正则 tab 中 `replaceString` 超长时 textarea 体验差
- [ ] 尚未接入真实外部模型账号做 API 供应商联调
- [ ] 尚未建立自动化 e2e / lint / test 回归门禁
