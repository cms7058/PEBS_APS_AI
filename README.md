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

```bash
cd /Users/mingyue/PEBS_APS_AI/app
npm install
npm run dev -- --port 5173
```

访问：

```text
http://127.0.0.1:5173/
```
