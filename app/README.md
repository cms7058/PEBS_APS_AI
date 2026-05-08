# PEBS APS AI MVP App

这是 AI 动态排产智能体的首版可运行 MVP，用于客户演示、限时试用和 POC 前验证。

## 已实现能力

- 试用企业状态与试用限制提示。
- 样例订单、工艺、设备、班次、物料、在制品数据。
- CSV 粘贴导入订单、工艺路线、设备资源。
- CSV 文件上传后读取到导入框。
- 客户字段智能匹配：支持中文/英文/常见 ERP 表头自动映射到系统字段。
- 字段映射确认：缺失或匹配不准时，用户可手动选择对应字段。
- 导入字段校验与试用规模限制提示。
- 今日排产次数限制，本地记录试用消耗。
- 试用到期或额度用尽后锁定新增导入和重排。
- 导出带试用声明的 POC Markdown 报告。
- 基础有限产能排产模拟。
- 设备维度甘特图。
- 甘特图任务块显示订单、工序、开始结束时间、工序耗时。
- 选中甘特图任务后展示工序详情和工序明细表。
- 加工时序分组视图：支持按设备、按订单、按零件查看工序顺序。
- XLSX 导出：支持导出排产计划表，内含“按设备 / 按订单 / 按零件”3 个工作表，列名为中文。
- 物料检查计划表：点击后先在页面预览齐套检查清单，再由用户确认导出 XLSX。
- 物料配送计划表：点击后先在页面预览设备配送计划，再由用户确认导出 XLSX。
- DeepSeek V4 智能体对话：支持连续消息、快捷问题、订单/设备/风险/日报查询。
- 智能体动作卡片驱动主要功能，卡片会根据用户对话意图动态切换，左侧工作区标题会同步显示当前操作。
- 生成模拟数据：支持下载订单、工艺路线、设备资源 CSV，也可一键载入试排；模拟数据路径不再展示字段匹配和应用导入。
- 真实客户文件导入：只有点击“导入订单 / 导入工艺路线 / 导入设备”时才显示字段智能匹配、导入标签和“应用导入”。
- 试用额度重置卡片：用于客户演示和内部测试时清零今日排产次数。
- KPI：准交率、延期订单、瓶颈设备、平均延期。
- 订单风险列表。
- 急单插入重排。
- CNC-08 停机重排。
- 缺料影响重排。
- 插单、停机、缺料采用两步式场景预演：先展示输入变化、重排计算和观察点，用户确认后才执行重排。
- 插单、停机、缺料预演支持“载入模拟数据并检测”，用于在客户数据不足时快速验证场景，检测本身不消耗排产次数。
- AI 智能体解释订单延期、瓶颈设备和计划摘要。

## 当前算法

首版采用“规则预处理 + 交期优先启发式调度”的前端模拟算法，主要用于演示产品闭环。

后续正式算法服务建议替换为：

- OR-Tools CP-SAT。
- 计划冻结区。
- 滚动排产。
- 多目标方案对比。
- 局部重排。

## CSV 导入

当前支持在页面内粘贴 CSV 数据并覆盖试排：

- 订单：`order_id,customer,part_id,quantity,due_time,priority,order_type,status`
- 工艺路线：`part_id,operation_seq,operation_code,operation_name,predecessor_seq,eligible_resources,setup_minutes,run_minutes_per_piece,inspection_minutes,outsourcing_flag,tooling_required`
- 设备资源：`resource_id,resource_name,resource_type,work_center,capability_tags,calendar_id,status,alternative_group`

注意：工艺路线中的 `eligible_resources` 使用 `|` 分隔多个可选设备。

导入时系统会先解析客户原始表头，再根据别名自动匹配系统字段。例如：

- `订单编号`、`客户订单号`、`so_no` 可匹配到 `order_id`
- `料号`、`物料编码`、`产品编码` 可匹配到 `part_id`
- `需求数量`、`订单数量`、`qty` 可匹配到 `quantity`
- `交货日期`、`要求交期`、`due_date` 可匹配到 `due_time`

若必填字段没有匹配，页面会标红提示，用户可通过下拉框手动指定字段。

说明：如果使用“生成模拟数据”，系统会直接载入标准 CSV 数据并生成排产，不需要再经过“应用导入”。“字段智能匹配”和“订单 / 工艺路线 / 设备”标签只用于客户上传真实 CSV 时做字段转换。

## 试用控制

当前前端 MVP 已实现轻量试用控制：

- 显示剩余试用天数。
- 显示今日排产次数。
- 基础排产、急单、停机、缺料、导入后重排都会消耗 1 次额度。
- 达到每日上限后，新增重排和导入按钮禁用。
- 右侧智能体提供“重置额度”动作卡片，可在当前浏览器页面中清零今日排产次数，便于演示继续进行。
- 导出报告包含“试用版，仅用于 POC 验证，不作为正式生产计划依据”的声明。

正式商用时应将这些限制迁移到后端账号和租户服务中，避免前端被绕过。

## 启动

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

本地如需启用 DeepSeek 代理：

```bash
export DEEPSEEK_API_KEY="你的 DeepSeek API Key"
npm run agent-server
```

生产模式可先构建再启动单进程服务：

```bash
npm run build
PORT=8787 npm start
```

## DeepSeek V4 智能体

右侧智能体对话已接入 DeepSeek V4 的本地代理服务。页面内提供“大模型配置”，用户可自行配置：

- 供应商：DeepSeek
- 模型：`deepseek-v4-pro` 或 `deepseek-v4-flash`
- Base URL：默认 `https://api.deepseek.com`
- API Key

配置会保存在浏览器本地存储，并通过 `/api/agent` 代理转发到 DeepSeek。本地开发时，如 Vite dev server 运行在 `5173` 端口，需要另开一个终端启动代理：

```bash
cd /Users/mingyue/PEBS_APS_AI/app
npm run agent-server
```

也可以继续用环境变量提供默认配置：

```bash
export DEEPSEEK_API_KEY="你的 DeepSeek API Key"
export DEEPSEEK_MODEL="deepseek-v4-pro"
export DEEPSEEK_BASE_URL="https://api.deepseek.com"
npm run agent-server
```

前端会调用相对路径：

```text
/api/agent
```

如果未配置 `DEEPSEEK_API_KEY`，页面不会中断，会自动降级到本地排产规则引擎回答。

当前默认模型：

```text
deepseek-v4-pro
```

## 用户使用说明

详见：

[USER_GUIDE.md](/Users/mingyue/PEBS_APS_AI/app/USER_GUIDE.md)

## 构建

```bash
npm run build
```

## Docker 部署

项目根目录已经提供：

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `.dockerignore`

部署命令：

```bash
cd /Users/mingyue/PEBS_APS_AI
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY
docker compose up -d --build
```

默认访问：

```text
http://服务器IP:8787/
```

健康检查：

```bash
curl http://服务器IP:8787/health
curl http://服务器IP:8787/api/health
```
