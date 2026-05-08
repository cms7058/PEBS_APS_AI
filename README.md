# PEBS APS AI 项目资料包

本目录用于保存 AI 排产智能体项目的开发资料、客户验证资料和后续交付文件。

## 目录结构

- `ai-scheduling-agent-dev-doc.md`：CNC 与汽车零部件行业 AI 排产智能体开发文档。
- `conversation-summary.md`：本次项目讨论摘要。
- `customer-validation-package/`：客户验证包，用于访谈、POC 沟通和早期销售验证。
- `templates/`：POC 数据采集模板。
- `mvp/`：MVP PRD、试用限制策略、开发 Backlog 和数据模型草案。
- `app/`：已开发的 AI 排产智能体 MVP 前端应用。

## 当前建议

项目应先做客户验证和 POC，再开发完整 MVP。优先切入 CNC 机加工场景，拿真实订单、工艺、设备和班次数据验证有限产能排产、插单重排、设备故障重排、延期原因解释等核心价值。

## 运行 MVP 应用

### 本地开发

```bash
cd /Users/mingyue/PEBS_APS_AI/app
npm install
npm run dev -- --port 5173
```

访问：

```text
http://127.0.0.1:5173/
```

如需启用 DeepSeek 对话代理，本地另开终端：

```bash
cd /Users/mingyue/PEBS_APS_AI/app
export DEEPSEEK_API_KEY="你的 DeepSeek API Key"
npm run agent-server
```

### Docker 部署

复制环境变量样例：

```bash
cd /Users/mingyue/PEBS_APS_AI
cp .env.example .env
```

编辑 `.env`，填写：

```text
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-v4-pro
APP_PORT=8787
```

构建并启动：

```bash
docker compose up -d --build
```

访问：

```text
http://服务器IP:8787/
```

健康检查：

```bash
curl http://服务器IP:8787/health
curl http://服务器IP:8787/api/health
```

停止：

```bash
docker compose down
```

说明：当前 Docker 版本为单容器部署，容器内同时提供前端静态页面和 `/api/agent` 大模型代理接口。
