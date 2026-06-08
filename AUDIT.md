# Nika Studio 代码质量审计

日期：2026-06-08

## 审计结论

当前代码可以通过 TypeScript/Vite 生产构建，生产依赖审计也没有发现已知漏洞。结合新的产品说明，本项目按“单用户系统”审计，登录功能的目标是过滤公网非法访问，而不是做多租户权限隔离。在这个前提下，最需要先处理的是：当前登录门禁不足以承担公网访问过滤、同步 API 只有 Vite dev 中间件实现、开发代理需要默认禁用并从 UI 隐藏、小说世界书渲染存在 XSS 面。

这份审计没有改业务代码，只生成报告。

## 产品假设更新

- 这是单用户系统，不按多用户 SaaS 或多租户云同步模型评估。
- 登录功能的目标是阻挡公网未授权访问，而不是管理多个真实用户。
- `/proxy/*` 暂时用不到；建议保留代码，但默认 disable，并隐藏所有“使用本地开发代理”的 UI 入口。
- 下列安全结论按“公网单用户门禁”重新表述：问题核心不是租户越权，而是门禁绕过、敏感配置泄露和公开服务滥用。

## 已验证

- `npm run build`：通过。
- `npm audit`：0 vulnerabilities。
- `npm audit --omit=dev`：0 vulnerabilities。
- `npm outdated --json`：仅显示 `vue-router` 有 5.x 主版本可评估、`@types/node` 有 25.x 主版本可评估，不属于当前阻断问题。
- `npm run preview` 下访问 `/api/settings?username=test` 返回的是 `text/html` 的 SPA fallback，而不是 JSON API。这确认了当前 `/api/*` 只存在于 Vite dev server。

## 主要发现

### Critical：单用户公网访问门禁不足，API Key 仍暴露在弱鉴权后

位置：

- `vite.config.ts:33-36`
- `vite.config.ts:107-189`
- `src/App.vue:21-25`
- `src/App.vue:66-75`
- `src/services/settingsService.ts:22-30`

问题：

`/api/auth/login` 首次登录会自动注册用户，密码明文写入 `server-auth.json`。登录成功后，客户端只把 `nika_username` 存进 `localStorage`，后续 `/api/settings` 的 GET/POST 只依赖 query/body 中的 `username`，没有 session、token、密码复验或服务端访问会话。与此同时，Vite 中间件给 `/api/*` 设置了 `Access-Control-Allow-Origin: *`。

影响：

在单用户系统中，这不是“多租户越权”问题，而是公网门禁本身不牢。任意访客可以尝试首次注册入口，或在知道/猜到用户名后直接请求 settings API。settings 内会包含 `apiConfig` 和 `apiProfiles`，也就是 LLM API Key。`src/App.vue:25` 还会把下载的完整 settings 打到浏览器 console，进一步扩大泄露面。

建议：

把这套逻辑从 Vite config 中移出，作为真实后端或受保护的单用户网关实现。密码用强哈希保存；登录后签发 httpOnly secure session cookie 或短期 token；settings/state 读写只允许当前已认证的单用户身份，不接受客户端传入的 username 作为授权依据；关闭通配 CORS；不要同步或日志输出明文 API Key，至少要做加密/脱敏。

### Critical：`/proxy/*` 当前等价开放代理，应默认禁用并隐藏入口

位置：

- `vite.config.ts:44-86`
- `vite.config.ts:269-271`
- `src/services/apiService.ts:48-52`

问题：

`/proxy/:protocol/:host/*` 接受任意 http/https 目标，没有 host allowlist，也没有内网地址拦截、认证、速率限制或 body 大小限制。它会转发除少量浏览器头外的大部分请求头，包括 `Authorization`。开发服务器还配置为 `host: '0.0.0.0'`，并允许 `nika.zkx.ca` 访问。用户已确认该代理暂时用不到。

影响：

如果 dev server 暴露在公网，这个端点可被用作开放代理或 SSRF 跳板访问内网/云元数据服务，也可能把用户 Authorization/API Key 转发到非预期目标。Gemini 请求把 key 放在 URL query 中，代理还会在 `vite.config.ts:53` 记录完整目标 URL，日志会包含 key。

建议：

暂时不要删除代码，但要默认禁用。建议用环境变量或构建开关控制，例如未显式设置 `ENABLE_DEV_PROXY=true` 时直接返回 404；同时隐藏 `ApiConfigPanel.vue` 和 `ChatView.vue` 中的“使用本地开发代理”开关。后续确实需要 CORS 代理时，只允许显式配置的 LLM provider 域名，拒绝 localhost、内网、link-local 和 metadata IP；不要转发浏览器传来的 Authorization；对请求体、响应体、超时和并发设限；只在本机开发环境启用。

### High：正式部署路径需要匹配“单用户公网门禁”目标

位置：

- `README.md`
- `vite.config.ts:25-28`
- `src/App.vue:62-120`

问题：

README 把 `dist/` 静态 HTTP/HTTPS 托管描述为正式运行方式，但应用首屏强制登录，登录请求固定打到 `/api/auth/login`。这些 API 只在 `configureServer` 中注册，也就是只存在于 `vite dev`，不会随 `vite build` 进入 `dist/`。本地验证 `npm run preview` 时 `/api/settings?username=test` 返回 `text/html` 的 `index.html` fallback。

影响：

按 README 的静态部署方式发布后，用户无法正常登录，设置同步和小说进度同步也不可用。如果反过来用 `npm run dev` 当公网服务，当前登录门禁和 proxy 暴露面又不足以承载公网访问。

建议：

按单用户系统重新定义生产部署：要么在静态站点前加真实访问网关，例如反向代理 Basic Auth、OAuth2 proxy、Cloudflare Access 等；要么提供一个最小后端承载 `/api/auth/login`、settings 和 novel-state。不要把 Vite dev middleware 当生产 API。

### High：小说状态文件路径可被用户名穿越

位置：

- `vite.config.ts:202-247`

问题：

`/api/novel-state` 直接把 `username` 拼进文件名：

```ts
path.join(root, `novel-state-${username}.json`)
```

看似有 `novel-state-` 前缀，但用户名允许路径分隔符。仅计算路径即可复现：`..\..\..\outside` 会归一化到项目目录外的 `C:\Users\freefrank\Desktop\outside.json`。

影响：

攻击者可以构造用户名，让 POST/GET/DELETE 作用到项目目录外的 `.json` 文件路径。结合弱门禁和通配 CORS，这是任意 JSON 文件写入/读取/删除风险。

建议：

用户名只允许固定字符集，例如 `/^[a-zA-Z0-9_-]{1,64}$/`；更好的是完全不用用户名拼路径，改为认证后的 user id。所有文件路径必须 `resolve` 到专用 data 目录，并校验结果仍在该目录下。

### High：小说世界书 Markdown 渲染未清洗，存在 XSS 面

位置：

- `src/views/NovelView.vue:60-63`
- `src/views/NovelView.vue:1787-1790`

问题：

`NovelView` 的 `renderMarkdown` 直接返回 `marked.parse(content)`，随后用 `v-html` 渲染。`marked` 不负责 HTML 清洗。这里的内容来自小说文本和模型生成的世界书条目，都是不可信输入。

影响：

恶意小说文本或模型输出可以注入 HTML/脚本事件载荷。由于同一 origin 下保存了 `nika_settings`、`nika_username` 和 IndexedDB 数据，XSS 可直接读取本地 API Key、角色卡和聊天/Agent 数据。

建议：

复用 `ChatView` 的模式：`marked.parse` 后用 DOMPurify 清洗再 `v-html`。同时为应用加 CSP，尽量禁止 inline script 和非白名单外连资源。对世界书条目也可以提供纯文本预览模式。

### Medium：请求体和文件持久化没有大小限制，且大量同步文件 IO 会阻塞服务

位置：

- `vite.config.ts:62-69`
- `vite.config.ts:108-109`
- `vite.config.ts:150-151`
- `vite.config.ts:216-220`
- `src/views/NovelView.vue:1009-1039`

问题：

代理和 JSON API 都把请求体完整读入内存，没有最大尺寸限制。小说进度保存会把 `fileContent`、章节、世界书和中间结果整体序列化，并优先 POST 到服务端；仓库根目录已有数 MB 级 `novel-state*.json` 文件。Vite 中间件使用 `fs.writeFileSync/readFileSync/unlinkSync`，会阻塞 dev server 事件循环。

影响：

大文件或恶意请求可以造成内存膨胀、请求阻塞或磁盘快速增长。长篇小说处理过程中频繁保存大状态，也会拖慢交互。

建议：

对所有 API 请求体设置硬上限；小说进度只保存必要增量；服务端文件 IO 改异步；状态文件放到专用 data 目录；保存动作做 debounce/backoff，并暴露保存失败状态。

### Medium：角色正则脚本可造成前端 ReDoS/卡死

位置：

- `src/services/regexService.ts:18-36`
- `src/views/AgentView.vue:228-254`

问题：

角色卡和 Agent patch 都可以写入任意 `findRegex`，渲染聊天消息时会在主线程构造 `RegExp` 并对文本执行 `replace`。当前只校验字段类型，不校验正则复杂度、长度或执行成本。

影响：

灾难性回溯表达式可让聊天渲染卡死。由于 regex 可以由模型 patch 写入，即使有确认弹窗，用户也很难判断表达式是否安全。

建议：

限制 regex 长度和 flags；保存前做安全校验；应用正则放到 Web Worker 并加超时；必要时使用安全正则引擎或改为受限替换规则。

### Medium：PNG/角色卡导入缺少输入上限和结构校验

位置：

- `src/services/cardIO.ts:91-157`

问题：

PNG 解析没有验证 chunk 边界和 CRC，`chara` 内容会直接 `atob`、`pako.inflate`、`JSON.parse`。没有压缩数据大小、解压后大小或 JSON 结构深度限制。

影响：

异常 PNG 或压缩炸弹可造成内存/CPU 峰值，导入失败也只返回 null，用户拿不到明确错误原因。

建议：

导入前限制文件大小；解析 PNG chunk 时校验边界和 CRC；限制压缩数据和解压后 JSON 大小；对角色卡结构做 schema 校验，并把错误反馈到 UI。

### Medium：核心业务逻辑集中在大 SFC，缺少测试和 lint 门禁

位置：

- `src/views/NovelView.vue`：约 1704 行
- `src/views/EditorView.vue`：约 868 行
- `src/views/AgentView.vue`：约 629 行
- `package.json`

问题：

小说解析、状态恢复、模型调用、JSON 修复、世界书合并、角色卡写入都集中在单个 Vue SFC 中。`package.json` 只有 `dev/build/preview`，没有 lint、unit test、e2e 或格式检查脚本。

影响：

已有代码里有多条跨模块数据链路，缺少回归测试会让安全修复和重构风险升高。当前 `npm run build` 只能证明类型和打包通过，不能覆盖登录、导入、保存、Agent patch、小说恢复等主流程。

建议：

把 `NovelView` 中的解析、合并、状态持久化、模型响应修复提取为可测试服务/组合函数；引入 Vitest 覆盖纯函数；用 Playwright 覆盖角色保存、API 配置保存、聊天持久化、Agent patch 确认、小说进度恢复；加入 ESLint/Prettier 或等价门禁。

## 正向观察

- IndexedDB 写入路径已通过 `cloneForStorage` 处理 Vue proxy，旧版报告中的 `DataCloneError` 阻断问题在当前代码中已有针对性修复。
- `ChatView` 和 `AgentView` 的普通 Markdown 渲染已使用 DOMPurify。
- Agent patch 当前已有字段白名单、类型校验、确认弹窗和修改前快照，比“直接执行模型输出”安全很多。
- `dist/`、`server-auth.json`、`novel-state*.json` 已在 `.gitignore` 中排除，降低了误提交运行态数据的概率。

## 建议修复顺序

1. 按“单用户公网系统”固定生产部署方案：前置访问网关，或最小真实后端；不要用 Vite dev server 承担公网门禁。
2. 保留 proxy 代码，但默认禁用 `/proxy/*`，并隐藏所有 `useProxy` UI 开关。
3. 加固登录/settings/novel-state：强密码哈希、真实会话、关闭通配 CORS、禁止客户端 username 直接决定读写对象。
4. 修复 `NovelView` 的 `v-html` 清洗。
5. 为小说状态、导入文件、代理请求和 regex 执行加大小/时间/路径边界。
6. 补最小回归测试：登录/设置、角色 CRUD、聊天保存、Agent patch、小说进度恢复、生产静态部署可用性。
