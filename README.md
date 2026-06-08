# 妮卡角色工作室 Pro — 重构版

Vue 3 重写版本的 [Nika Character Studio](../Nika-Character-Studio-main)，从 4.4 万行无模块化原生 JS 重构为现代前端架构。

## 技术栈

- **Vue 3** Composition API + `<script setup>`
- **Vite** 构建，热更新
- **TypeScript** 严格模式
- **Tailwind CSS v4** + CSS 变量主题
- **Pinia** 状态管理
- **Vue Router 4** Hash 模式（无服务器部署）
- **IndexedDB** 本地数据持久化（角色、聊天、Agent 对话）
- **pako** PNG tEXt chunk 解析/写入（SillyTavern 兼容）
- **marked** Markdown 渲染

## UI/UX 视觉与体验升级

重构版引入了现代高奢暗色美学与玻璃拟态（Glassmorphism）设计系统，核心体验升级点包括：

- **极奢暗色主题**：精心调配的深邃暗色底色，辅以紫、粉、蓝霓虹（Neon）发光粒子微背景。
- **玻璃拟态卡片**：所有的卡片与模态弹窗均采用 frosted glass frosted panel 设计，并支持 `backdrop-blur-md` 强背景高斯模糊。
- **流畅交互微动效**：
  - 角色卡片在鼠标悬停时会向上浮动并散发紫色霓虹光晕，同时滑入毛玻璃快捷操作按钮层。
  - 所有表单控件、发送按钮及开关切换（Toggles）均具有平滑的缩放和边框微动效。
- **自适应分栏编辑器**：PC 端提供高效的左侧固定的垂直选项卡导航栏与头像管理，移动端自动缩回为横向滚动的胶囊 Tap 菜单，最大化提升信息密度。
- **沉浸式气泡对话**：AI 气泡左侧具有专属流光渐变彩条，代码块与引用做了高对比排版美化，发送栏重构为居中浮动设计，更具现代社交应用沉浸感。

## 快速开始

```bash
cd nika-studio
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 生产构建 → dist/
npm run preview  # 本地 HTTP 预览 http://localhost:4173
```

生产环境以 **HTTP/HTTPS 静态服务** 托管 `dist/` 为正式运行方式；不支持把 `dist/index.html` 作为 `file://` 直接打开来运行。

推荐部署方式：

- 本地验证：`npm run preview`
- 公开服务：使用 Nginx、Caddy、静态托管平台或 Node 静态服务发布 `dist/`
- `index.html` 不长期缓存，`assets/*` 可按 hash 文件名长期缓存
- 公网访问建议启用 HTTPS，并设置 `X-Content-Type-Options: nosniff`

## 项目结构

```
src/
├── types/index.ts          # 全局类型（SillyTavern V2/V3 兼容）
├── services/
│   ├── db.ts               # IndexedDB 通用封装
│   ├── characterService.ts # 角色 CRUD
│   ├── chatService.ts      # 聊天会话 CRUD
│   ├── agentService.ts     # Agent 对话持久化
│   ├── settingsService.ts  # 全局设置（localStorage）
│   ├── apiService.ts       # LLM API（DeepSeek/Gemini/OpenAI兼容/本地）
│   └── cardIO.ts           # PNG/JSON 导入导出，Lorebook 导出
├── stores/
│   ├── characterStore.ts   # Pinia 角色状态
│   └── apiConfigStore.ts   # Pinia 多 API 配置管理
├── components/
│   └── ApiConfigPanel.vue  # API 配置面板组件
└── views/
    ├── LibraryView.vue     # 角色库主页
    ├── EditorView.vue      # 角色编辑器
    ├── ChatView.vue        # 聊天界面
    ├── AgentView.vue       # Nika AI 助手
    ├── NovelView.vue       # 小说转世界书
    └── SettingsView.vue    # 全局设置
```

## 路由

| 路径 | 视图 | 说明 |
|------|------|------|
| `/` | LibraryView | 角色库，PNG/JSON 导入 |
| `/editor` | EditorView | 创建新角色 |
| `/editor/:id` | EditorView | 编辑已有角色 |
| `/chat/:id` | ChatView | 与角色聊天 |
| `/agent/:id` | AgentView | AI 助手编辑角色卡 |
| `/novel-to-worldbook` | NovelView | 小说转世界书 |
| `/settings` | SettingsView | 全局设置 |

## 主要功能

### 角色编辑器（6 个 Tab）
| Tab | 内容 |
|-----|------|
| 基础 | 名称、描述、性格、场景，每个字段带 ✨ AI 补全 |
| 对话 | 首条消息、对话示例、系统提示词、后置指令 |
| 问候语 | 首条消息 + 多个备用开场白（alternate_greetings） |
| 元数据 | 标签、创作者、版本、备注 |
| 世界书 | 条目 CRUD，🔮 AI 批量生成 |
| 正则 | regex_scripts 管理（新增、编辑、启用/禁用） |

**工具栏**：🔮 AI生成整卡 · 🌐 译中/译EN（含撤销）· JSON/PNG/Lorebook 导出 · 🎨 AI前端美化

### Nika AI 助手
- 对话式编辑角色卡，识别并校验 `json:patch` 代码块后再应用
- 支持 `worldbook_add/update`、`greeting_add`、`regex_add/update`
- `/peek field|worldbook|regex <索引>` — 查看字段全文
- `/list all|worldbook|fields` — 列举字段/条目
- HTML 代码块 iframe 预览，默认按不可信内容隔离

### API 支持
- **DeepSeek** `deepseek-chat`
- **Google Gemini** SSE 流式
- **OpenAI 兼容** 任意自定义 base URL
- **本地模型** Ollama 等

### 数据格式
完全兼容 SillyTavern **V2 / V3** 角色卡格式，PNG 读写使用 `tEXt` chunk + pako deflate。

## 原项目对比

| 维度 | 原版 | 重构版 |
|------|------|--------|
| 代码量 | ~44,000 行混合 | ~2,500 行模块化 |
| 架构 | 无模块，全局函数 | Vue SFC + Pinia + TS |
| 构建工具 | 无 | Vite |
| 类型安全 | 无 | TypeScript 严格模式 |
| 可维护性 | 极低 | 高 |
