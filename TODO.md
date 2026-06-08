# TODO

> 最后更新：2026-06-08

## 当前目标

以 [AUDIT.md](./AUDIT.md) 为准，已完成发布阻断与高风险修复；下一步把手动验证固化为可重复回归门禁，再恢复功能增强。

---

## P0：发布阻断

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

## P1：高优先级修复

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

## P2：最小回归验证

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

## P3：稳定后继续

- [ ] **Agent 快照回滚面板**
- [ ] **ChatView 多会话**
- [ ] **NovelView 分类持久化**
- [ ] **模型列表缓存**
- [ ] **世界书批量操作**
- [ ] **聊天导出**
- [x] **移动端适配优化**

---

## 已知问题

- [x] **AgentView `/peek` 响应已支持 Markdown 渲染与美化代码块**
- [ ] EditorView 正则 tab 中 `replaceString` 超长时 textarea 体验差
- [ ] 尚未接入真实外部模型账号做 API 供应商联调
- [ ] 尚未建立自动化 e2e / lint / test 回归门禁
