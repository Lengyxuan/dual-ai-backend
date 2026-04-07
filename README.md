# 🤖 AI智囊团 · 双角色引擎

一个基于 **Node.js + Express** 的后端服务和现代前端组成的 AI 辩论工具。让 **Builder（构建者）** 与 **Critic（批判者）** 两个 AI 角色围绕用户问题展开多轮、逐条反驳的深度辩论，并支持 **Observer（观察者）** 自动判断共识。所有对话通过 SSE 实时推送，体验流畅。

## ✨ 功能特性

- **双角色隔离辩论**  
  Builder（建设性观点）与 Critic（质疑与风险分析）使用独立的 API Key，角色提示完全分离，可接入不同模型。

- **流式实时输出（SSE）**  
  后端每生成一条发言就立刻推送到前端，无需等待整轮结束，用户体验更佳。

- **对抗式逐轮反驳**  
  - 首轮：Builder 直接回应用户问题，Critic 反驳 Builder  
  - 后续轮次：双方严格针对上一条发言（对方观点）进行反驳、补充或深化，避免重复，引入新论点

- **灵活的控制能力**  
  - **终止辩论**：随时停止，后端立即取消进行中的 API 请求  
  - **继续讨论**：终止后可基于已有历史继续辩论，轮次计数自动延续  
  - **新建对话 / 清空对话**：管理多轮讨论会话

- **历史会话管理**  
  前端自动保存每个对话会话到 `localStorage`，支持加载、删除历史记录，最多保留 30 条会话。

- **智能滚动体验**  
  用户向上滚动时暂停自动滚动，避免被打断阅读；向下滚动到底部后恢复自动跟随新消息。

- **通用 API 兼容**  
  支持任何 OpenAI 兼容的 API 接口（OpenAI、Azure、DeepSeek、vLLM、LocalAI 等），只需配置 Base URL、模型名称和 API Key。

- **Observer 共识检测（可选）**  
  可额外配置一个 Observer API Key，自动分析 Builder 和 Critic 的最新发言，判断是否达成共识并提前结束辩论。

- **美观的 UI**  
  Builder 使用薄荷绿背景，Critic 使用暖杏色背景，区分度高且不刺眼，支持暗色滚动条和柔和动画。

## 🚀 快速开始

### 前置要求
- Node.js 18+ 环境
- 一个有效的 OpenAI 兼容 API Key（Builder 和 Critic 可共用同一个 Key，也可使用不同 Key）
- （可选）Observer API Key

### 1. 安装后端依赖


npm install express cors axios dotenv

###  2. 配置环境变量

创建 .env 文件（也可以完全在前端设置中填写，后端环境变量作为默认值）：

默认 API 配置（前端设置会覆盖）

API_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo

# API Keys（如果不希望前端传递，可在此配置，更安全）
BUILDER_API_KEY=sk-xxxxx
CRITIC_API_KEY=sk-xxxxx

PORT=30001

### 3. 启动后端服务

node server.js


### ⚙️ 配置说明
前端设置项（点击设置按钮）
参数	说明	示例
API Base URL	OpenAI 兼容接口的根地址	https://api.openai.com/v1
模型名称	使用的模型 ID	gpt-3.5-turbo, deepseek-chat
Builder API Key	构建者角色的 API Key	sk-xxxxxxxx
Critic API Key	批判者角色的 API Key	sk-yyyyyyyy
最大辩论轮数	每次触发辩论的最大轮数	10
这些设置会保存在浏览器本地，下次打开自动加载。


## 🌐 部署建议

### 后端部署

使用 pm2 或 systemd 保持服务常驻
设置反向代理（如 Nginx）处理 HTTPS 和 CORS
推荐将 API Key 放在后端环境变量中，前端不再传递，增强安全性

### 前端部署
纯静态文件，可托管在：

GitHub Pages
Vercel / Netlify
任何 HTTP 服务器（python -m http.server 或 npx serve）

前端需要知道后端的实际地址（可通过修改 index.html 中的 BACKEND_URL 常量实现）。

# 📄 许可证
MIT
