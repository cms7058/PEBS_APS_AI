import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  Factory,
  FileDown,
  Gauge,
  KeyRound,
  LogIn,
  Mail,
  Play,
  RefreshCw,
  ShieldAlert,
  Upload,
  Wrench,
} from 'lucide-react';
import {
  fieldDefinitions,
  parseByKindWithMapping,
  parseCsv,
  suggestMapping,
  type FieldMapping,
  type ImportIssue,
  type ImportKind,
} from './csvImport';
import {
  sampleCalendar,
  sampleInventory,
  sampleOrders,
  sampleResources,
  sampleRoutings,
  sampleWip,
  trialState,
} from './sampleData';
import { explainOrderDelay, formatDateTime, runSchedule } from './scheduler';
import type { Order, Resource, Routing, ScheduledOperation, SchedulePlan } from './types';
import './styles.css';

const daysLeft = () => {
  const end = new Date(trialState.endAt);
  const now = new Date('2026-05-06T12:00:00');
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
};

const inviteVerifyUrl = '/api/invite-verify';
const authRedirectUrl = 'https://lingcan.pebs.online/#/pages/copilot/index';
const authStorageKey = 'pebs-aps-ai-trial-auth';
const minutesToHours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;
const trialStorageVersion = '2026-05-07-reset-runs-v1';
const enableTrialReset = import.meta.env.VITE_ENABLE_TRIAL_RESET === 'true';
const enableClientModelConfig = import.meta.env.VITE_ENABLE_CLIENT_MODEL_CONFIG === 'true';
const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const subtractMinutes = (date: Date, minutes: number) => new Date(date.getTime() - minutes * 60_000);

const formatExcelDateTime = (date: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

const getInitialRuns = () => {
  const storedVersion = localStorage.getItem('pebs-aps-ai-runs-version');
  if (storedVersion !== trialStorageVersion) {
    localStorage.setItem('pebs-aps-ai-runs-version', trialStorageVersion);
    localStorage.setItem('pebs-aps-ai-runs', String(trialState.todayRuns));
    return trialState.todayRuns;
  }
  const stored = Number(localStorage.getItem('pebs-aps-ai-runs') ?? trialState.todayRuns);
  return Number.isFinite(stored) ? stored : trialState.todayRuns;
};

const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const buildTrialReport = (plan: SchedulePlan) => {
  const delayed = plan.operations
    .filter((op) => op.delayMinutes > 0)
    .sort((a, b) => b.delayMinutes - a.delayMinutes)
    .slice(0, 10);
  const rows = delayed.length
    ? delayed.map((op) => `| ${op.orderId} | ${op.customer} | ${op.partId} | ${op.operationName} | ${op.resourceId} | ${minutesToHours(op.delayMinutes)} | ${op.delayReason || '资源排队'} |`).join('\n')
    : '| 无 | - | - | - | - | - | 当前方案无延期订单 |';

  return `# PEBS APS AI 试用版排产报告

> 试用版，仅用于 POC 验证，不作为正式生产计划依据。

## 方案摘要

- 方案名称：${plan.name}
- 生成时间：${plan.generatedAt.toLocaleString('zh-CN')}
- 目标函数：${plan.objective}
- 排产工序数：${plan.kpi.scheduledOperations}
- 准交率：${plan.kpi.onTimeRate}%
- 延期订单：${plan.kpi.delayedOrders}/${plan.kpi.totalOrders}
- 平均延期：${plan.kpi.avgDelayHours} 小时
- 瓶颈设备：${plan.kpi.bottleneckResource}

## 延期风险

| 订单号 | 客户 | 零件号 | 工序 | 设备 | 延期 | 原因 |
| --- | --- | --- | --- | --- | ---: | --- |
${rows}

## 试用限制

- 试用截止：${trialState.endAt}
- 单企业最多设备：${trialState.maxResources}
- 单企业最多订单：${trialState.maxOrders}
- 每日排产次数：${trialState.dailyRunsLimit}
`;
};

const makeUrgentOrder = (): Order => ({
  orderId: `SO-URG-${Date.now().toString().slice(-4)}`,
  customer: '客户A',
  partId: 'P-A320-01',
  quantity: 40,
  dueTime: '2026-05-12 20:00',
  priority: '高',
  orderType: '急单',
  status: '待排产',
});

function KpiCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="kpi-card">
      <div className={`kpi-icon ${tone ?? ''}`}>{icon}</div>
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
      </div>
    </div>
  );
}

function TrialBar({ runsToday, locked }: { runsToday: number; locked: boolean }) {
  const left = daysLeft();
  return (
    <section className="trial-bar">
      <div>
        <div className="eyebrow">试用企业</div>
        <h1>{trialState.tenantName}</h1>
      </div>
      <div className="trial-metrics">
        <span><CalendarClock size={16} />剩余 {left} 天</span>
        <span className={locked ? 'locked' : ''}><RefreshCw size={16} />今日排产 {runsToday}/{trialState.dailyRunsLimit}</span>
        <span><ShieldAlert size={16} />试用版限制：50 台设备 / 500 订单 / 5 个方案</span>
      </div>
    </section>
  );
}

const csvExamples: Record<ImportKind, string> = {
  orders:
    'order_id,customer,part_id,quantity,due_time,priority,order_type,status\nSO-NEW-001,客户X,P-A320-01,30,2026-05-12 16:00,高,正式订单,待排产',
  resources:
    'resource_id,resource_name,resource_type,work_center,capability_tags,calendar_id,status,alternative_group\nCNC-21,CNC二十一号机,CNC,机加工,CNC_3AXIS|ROUGH,CAL-01,可用,CNC_ROUGH',
  routings:
    'part_id,operation_seq,operation_code,operation_name,predecessor_seq,eligible_resources,setup_minutes,run_minutes_per_piece,inspection_minutes,outsourcing_flag,tooling_required\nP-X100-01,10,OP10,粗加工,,CNC-01|CNC-02,20,2.5,10,N,JIG-X1',
};

const simulationCsv: Record<ImportKind, string> = {
  orders: [
    'order_id,customer,part_id,quantity,due_time,priority,order_type,status',
    'SO-SIM-001,客户A,P-A320-01,80,2026-05-12 18:00,高,正式订单,待排产',
    'SO-SIM-002,客户B,P-B118-02,120,2026-05-13 12:00,中,正式订单,待排产',
    'SO-SIM-003,客户C,P-C077-06,60,2026-05-13 20:00,中,正式订单,待排产',
    'SO-SIM-004,客户A,P-A320-01,50,2026-05-14 16:00,高,备件,待排产',
  ].join('\n'),
  routings: [
    'part_id,operation_seq,operation_code,operation_name,predecessor_seq,eligible_resources,setup_minutes,run_minutes_per_piece,inspection_minutes,outsourcing_flag,tooling_required',
    'P-A320-01,10,OP10,粗加工,,CNC-01|CNC-02,25,2.6,10,N,JIG-01',
    'P-A320-01,20,OP20,精加工,10,CNC-08|CNC-12,40,4.8,20,N,JIG-02',
    'P-A320-01,30,OP30,终检,20,QC-01,10,0.7,35,N,',
    'P-B118-02,10,OP10,车削,,LATHE-01|LATHE-02,20,2.2,10,N,JIG-03',
    'P-B118-02,20,OP20,钻孔,10,CNC-01|CNC-02,25,1.4,10,N,',
    'P-C077-06,10,OP10,五轴加工,,CNC-12,55,6.5,25,N,JIG-12',
    'P-C077-06,20,OP20,磨削,10,GRIND-03,30,3.8,20,N,',
  ].join('\n'),
  resources: [
    'resource_id,resource_name,resource_type,work_center,capability_tags,calendar_id,status,alternative_group',
    'CNC-01,CNC一号机,CNC,机加工,CNC_3AXIS|ROUGH,CAL-01,可用,CNC_ROUGH',
    'CNC-02,CNC二号机,CNC,机加工,CNC_3AXIS|ROUGH,CAL-01,可用,CNC_ROUGH',
    'CNC-08,CNC八号机,CNC,精加工,CNC_5AXIS|PRECISION,CAL-01,可用,CNC_PRECISION',
    'CNC-12,CNC十二号机,CNC,精加工,CNC_5AXIS|PRECISION,CAL-01,可用,CNC_PRECISION',
    'LATHE-01,数控车床一号,Lathe,车削,LATHE,CAL-01,可用,LATHE_STD',
    'LATHE-02,数控车床二号,Lathe,车削,LATHE,CAL-01,可用,LATHE_STD',
    'GRIND-03,磨床三号,Grinding,磨削,GRIND,CAL-01,可用,GRIND_STD',
    'QC-01,质检一号,QC,质检,QC,CAL-01,可用,QC_STD',
  ].join('\n'),
};

const importKindLabel: Record<ImportKind, string> = {
  orders: '订单',
  resources: '设备',
  routings: '工艺路线',
};

type OperationGroupMode = 'resource' | 'order' | 'part';
type SequenceViewMode = 'operations' | 'material-inspection' | 'material-delivery';
type XlsxRow = Record<string, string | number>;
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};
type AgentAction = 'guide' | 'sample-data' | 'import-orders' | 'import-routings' | 'import-resources' | 'base-schedule' | 'urgent' | 'stop' | 'shortage' | 'export' | 'reset-trial';
type WorkspaceMode = AgentAction;
type ScenarioAction = 'urgent' | 'stop' | 'shortage';
type AgentStage = 'start' | 'guide' | 'import' | 'simulate' | 'analysis';
type ModelConfig = {
  provider: 'deepseek';
  model: string;
  baseUrl: string;
  apiKey: string;
};
type TrialAuth = {
  email: string;
  inviteCode: string;
  verifiedAt: string;
};

const workspaceCopy: Record<WorkspaceMode, { title: string; desc: string }> = {
  guide: { title: '开始使用', desc: '查看需要导入的文件、字段要求和推荐流程。' },
  'import-orders': { title: '导入订单', desc: '导入订单号、零件号、数量、交期等订单需求数据。' },
  'import-routings': { title: '导入工艺路线', desc: '导入每个零件的工序顺序、可选设备和标准工时。' },
  'import-resources': { title: '导入设备', desc: '导入设备编号、设备名称、能力标签和班次日历。' },
  'sample-data': { title: '生成模拟数据', desc: '下载或一键载入模拟订单、工艺路线和设备资源数据。' },
  'base-schedule': { title: '生成排产', desc: '基于当前数据生成基础有限产能排产方案。' },
  urgent: { title: '插单模拟', desc: '模拟急单插入后对设备、订单和交期的影响。' },
  stop: { title: '停机模拟', desc: '模拟 CNC-08 停机后受影响订单和重排方案。' },
  shortage: { title: '缺料模拟', desc: '模拟关键物料未齐套后订单顺延和风险变化。' },
  export: { title: '导出报告', desc: '导出带试用声明的 POC 排产报告。' },
  'reset-trial': { title: '重置试用额度', desc: '清零今日排产次数，用于客户演示和内部测试。' },
};

const operationGroupLabel: Record<OperationGroupMode, string> = {
  resource: '按设备',
  order: '按订单',
  part: '按零件',
};

const scenarioCopy: Record<ScenarioAction, {
  title: string;
  input: string[];
  calculation: string[];
  observe: string[];
  button: string;
}> = {
  urgent: {
    title: '插单重排预演',
    input: ['新增急单：客户A / P-A320-01 / 数量 40 / 交期 2026-05-12 20:00', '急单优先级设为高，并进入现有订单队列参与排序。'],
    calculation: ['重新按交期、优先级、工序先后关系计算任务顺序。', '在每道工序的可选设备中选择最早可用设备，并刷新甘特图。'],
    observe: ['急单是否准时完成。', '被挤占设备上的原订单是否延期。', '瓶颈设备和平均延期是否发生变化。'],
    button: '执行插单重排',
  },
  stop: {
    title: '设备停机重排预演',
    input: ['设置 CNC-08 在 2026-05-12 13:00 至 2026-05-13 10:00 不可用。', '该时段内 CNC-08 不再承接新工序，已有排程需要重新寻找可用窗口。'],
    calculation: ['排除停机窗口后重新计算设备可用时间。', '优先尝试同能力替代设备，再根据交期压力重新安排工序。'],
    observe: ['CNC-08 上的任务是否被顺延或转移。', '精加工工序是否形成新的排队。', '受影响订单在风险列表中的变化。'],
    button: '执行停机重排',
  },
  shortage: {
    title: '缺料影响重排预演',
    input: ['设置订单 SO-202605002 关键物料 M-B002 缺料。', '预计 2026-05-13 10:00 到料前，该订单不能开工。'],
    calculation: ['为缺料订单增加最早开工约束。', '释放原先占用的早期设备窗口，并让其他订单前移或重排。'],
    observe: ['缺料订单是否被顺延。', '空出的设备窗口是否被其他订单利用。', '延期原因是否明确显示为物料未齐套。'],
    button: '执行缺料重排',
  },
};

const detectAgentStage = (text: string): AgentStage => {
  const value = text.toLowerCase();
  if (/(怎么|如何|使用|开始|流程|引导|入门)/.test(value)) return 'guide';
  if (/(导入|订单|工艺|设备|字段|文件|csv|excel)/.test(value)) return 'import';
  if (/(模拟|样例|样本|插单|停机|缺料|测试数据|模拟数据)/.test(value)) return 'simulate';
  if (/(瓶颈|延期|风险|日报|分析|为什么|负荷)/.test(value)) return 'analysis';
  return 'analysis';
};

const getGroupKey = (op: ScheduledOperation, mode: OperationGroupMode) => {
  if (mode === 'resource') return op.resourceId;
  if (mode === 'order') return op.orderId;
  return op.partId;
};

const groupOperations = (operations: ScheduledOperation[], mode: OperationGroupMode) => {
  const groups = new Map<string, ScheduledOperation[]>();
  operations.forEach((op) => {
    const key = getGroupKey(op, mode);
    groups.set(key, [...(groups.get(key) ?? []), op]);
  });
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => a.start.getTime() - b.start.getTime()),
      totalMinutes: items.reduce((sum, op) => sum + op.runMinutes + op.setupMinutes, 0),
    }))
    .sort((a, b) => a.items[0].start.getTime() - b.items[0].start.getTime());
};

const getOrderById = (orders: Order[]) => new Map(orders.map((order) => [order.orderId, order]));

const buildMaterialRules = (partId: string, quantity: number) => {
  const normalized = partId.replace(/^P-/, '').replace(/[^A-Z0-9]/gi, '-');
  return [
    {
      materialId: `M-${normalized}-RAW`,
      materialName: `${partId} 主材毛坯`,
      requiredQty: quantity,
      unit: '件',
      materialType: '主材',
    },
    {
      materialId: `M-${normalized}-AUX`,
      materialName: `${partId} 辅料/刀辅具包`,
      requiredQty: Math.max(1, Math.ceil(quantity * 0.08)),
      unit: '套',
      materialType: '辅料',
    },
  ];
};

const scheduleRows = (plan: SchedulePlan, groupMode: OperationGroupMode) =>
  groupOperations(plan.operations, groupMode).flatMap((group) =>
    group.items.map((op) => ({
      分组: group.key,
      设备编号: op.resourceId,
      订单号: op.orderId,
      客户: op.customer,
      零件号: op.partId,
      工序序号: op.operationSeq,
      工序名称: op.operationName,
      开始时间: formatExcelDateTime(op.start),
      结束时间: formatExcelDateTime(op.end),
      准备时间分钟: op.setupMinutes,
      加工时间分钟: op.runMinutes,
      总耗时小时: Number(((op.setupMinutes + op.runMinutes) / 60).toFixed(2)),
      延期小时: Number((op.delayMinutes / 60).toFixed(2)),
      延期原因: op.delayReason || '',
    })),
  );

const materialInspectionRows = (plan: SchedulePlan, orders: Order[]) => {
  const orderMap = getOrderById(orders);
  const firstOps = new Map<string, ScheduledOperation>();
  plan.operations.forEach((op) => {
    const current = firstOps.get(op.orderId);
    if (!current || op.start < current.start) firstOps.set(op.orderId, op);
  });

  return [...firstOps.values()].flatMap((op) => {
    const order = orderMap.get(op.orderId);
    const quantity = order?.quantity ?? 0;
    return buildMaterialRules(op.partId, quantity).map((material) => ({
      订单号: op.orderId,
      客户: op.customer,
      零件号: op.partId,
      订单数量: quantity,
      物料号: material.materialId,
      物料名称: material.materialName,
      物料类型: material.materialType,
      需求数量: material.requiredQty,
      单位: material.unit,
      需求工序: `${op.operationSeq}/${op.operationName}`,
      计划开工时间: formatExcelDateTime(op.start),
      齐套检查截止时间: formatExcelDateTime(subtractMinutes(op.start, 24 * 60)),
      齐套状态: '待检查',
      缺口数量: '',
      备注: '试用版按零件号生成物料需求，正式版本接入 BOM 后替换。',
    }));
  });
};

const materialDeliveryRows = (plan: SchedulePlan, orders: Order[]) => {
  const orderMap = getOrderById(orders);
  return [...plan.operations]
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.start.getTime() - b.start.getTime())
    .flatMap((op) => {
      const order = orderMap.get(op.orderId);
      const quantity = order?.quantity ?? 0;
      return buildMaterialRules(op.partId, quantity).map((material) => ({
        设备编号: op.resourceId,
        配送工位: op.resourceId,
        订单号: op.orderId,
        客户: op.customer,
        零件号: op.partId,
        工序: `${op.operationSeq}/${op.operationName}`,
        物料号: material.materialId,
        物料名称: material.materialName,
        配送数量: material.requiredQty,
        单位: material.unit,
        计划开工时间: formatExcelDateTime(op.start),
        建议配送时间: formatExcelDateTime(subtractMinutes(op.start, 120)),
        最晚配送时间: formatExcelDateTime(subtractMinutes(op.start, 30)),
        配送状态: '待配送',
        备注: '按设备加工时序生成，供现场配送节拍核对。',
      }));
    });
};

const writeWorkbook = (filename: string, sheets: Record<string, XlsxRow[]> | XlsxRow[]) => {
  const workbook = XLSX.utils.book_new();
  if (Array.isArray(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets), '明细');
  } else {
    Object.entries(sheets).forEach(([sheetName, rows]) => {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
    });
  }
  XLSX.writeFile(workbook, filename, { compression: true });
};

const exportScheduleWorkbook = (plan: SchedulePlan) => {
  writeWorkbook(`排产计划表-${plan.name}.xlsx`, {
    按设备: scheduleRows(plan, 'resource'),
    按订单: scheduleRows(plan, 'order'),
    按零件: scheduleRows(plan, 'part'),
  });
};

const exportMaterialInspectionWorkbook = (plan: SchedulePlan, orders: Order[]) => {
  writeWorkbook(`物料检查计划表-${plan.name}.xlsx`, materialInspectionRows(plan, orders));
};

const exportMaterialDeliveryWorkbook = (plan: SchedulePlan, orders: Order[]) => {
  writeWorkbook(`物料配送计划表-${plan.name}.xlsx`, materialDeliveryRows(plan, orders));
};

const defaultModelConfig: ModelConfig = {
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
};

const loadModelConfig = (): ModelConfig => {
  try {
    const stored = localStorage.getItem('pebs-aps-ai-model-config');
    return stored ? { ...defaultModelConfig, ...JSON.parse(stored) } : defaultModelConfig;
  } catch {
    return defaultModelConfig;
  }
};

const findOrderIdInText = (text: string, plan: SchedulePlan) => {
  const explicit = text.match(/SO-[A-Z0-9-]+/i)?.[0]?.toUpperCase();
  if (explicit) return explicit;
  return plan.operations.find((op) => text.includes(op.orderId))?.orderId;
};

const findResourceInText = (text: string, plan: SchedulePlan) => {
  const normalized = text.toUpperCase();
  return [...new Set(plan.operations.map((op) => op.resourceId))].find((resourceId) => normalized.includes(resourceId.toUpperCase()));
};

const buildAgentReply = (question: string, plan: SchedulePlan) => {
  const text = question.trim();
  if (!text) return '请先输入你想查询的订单、设备、延期原因或日报。';

  const orderId = findOrderIdInText(text, plan);
  const resourceId = findResourceInText(text, plan);
  const delayed = plan.operations.filter((op) => op.delayMinutes > 0).sort((a, b) => b.delayMinutes - a.delayMinutes);

  if (/(帮助|怎么|如何|使用|开始|流程|入门)/.test(text) || text.toLowerCase().includes('help')) {
    return [
      '推荐有两条试用路径：',
      '1. 没有客户数据：点击“生成模拟数据”，下载或一键载入样例数据，再做插单、停机、缺料验证。',
      '2. 已有客户数据：依次导入订单、工艺路线、设备资源，确认字段智能匹配后应用导入。',
      '3. 生成排产后，在甘特图、订单风险和加工时序分组视图里看结果。',
      '4. 继续问我订单延期、瓶颈设备、风险清单或计划员日报。',
      '',
      '我已经把右侧卡片切换为当前问题对应的下一步动作，你可以直接点卡片继续。',
    ].join('\n');
  }

  if (/(导入|字段|文件|csv|excel)/i.test(text)) {
    return [
      '真实数据导入建议按这个顺序：',
      '1. 先导入订单：订单号、零件号、数量、交期是必填。',
      '2. 再导入工艺路线：零件号、工序序号、工序名称、可选设备是必填。',
      '3. 最后导入设备：设备编号、设备名称、日历编号是必填。',
      '4. 每次上传后检查字段智能匹配，缺失字段需要人工确认。',
    ].join('\n');
  }

  if (/(模拟|样例|样本|插单|停机|缺料|测试数据|模拟数据)/.test(text)) {
    return [
      '模拟验证建议先载入模拟数据，再选择场景：',
      '1. 插单模拟：新增高优先级急单，观察原订单是否被挤压。',
      '2. 停机模拟：加入 CNC-08 停机窗口，观察任务转移和延期变化。',
      '3. 缺料模拟：给指定订单增加最早开工约束，观察延期原因是否变化。',
      '每个场景都会先展示输入变化、计算逻辑和结果观察点，确认后才执行重排。',
    ].join('\n');
  }

  if (text.includes('日报') || text.includes('总结') || text.includes('报告')) {
    const topRisk = delayed.slice(0, 3).map((op) => `${op.orderId}/${op.operationName} 延期 ${minutesToHours(op.delayMinutes)}`).join('；') || '暂无延期风险';
    return [
      `计划员日报：当前方案为「${plan.name}」。`,
      `准交率 ${plan.kpi.onTimeRate}%，延期订单 ${plan.kpi.delayedOrders}/${plan.kpi.totalOrders}。`,
      `瓶颈设备为 ${plan.kpi.bottleneckResource}，负荷约 ${plan.kpi.utilization}%。`,
      `重点风险：${topRisk}。`,
      '建议：优先复核瓶颈设备负荷、缺料订单和高优先级客户订单。'
    ].join('\n');
  }

  if (text.includes('瓶颈')) {
    const resourceOps = plan.operations.filter((op) => op.resourceId === plan.kpi.bottleneckResource).sort((a, b) => a.start.getTime() - b.start.getTime());
    const seq = resourceOps.slice(0, 5).map((op) => `${op.orderId}/${op.partId}/${op.operationName} ${formatDateTime(op.start)}-${formatDateTime(op.end)}`).join('；');
    return `当前瓶颈设备是 ${plan.kpi.bottleneckResource}，负荷约 ${plan.kpi.utilization}%。该设备主要任务：${seq || '暂无任务'}。`;
  }

  if (resourceId) {
    const resourceOps = plan.operations.filter((op) => op.resourceId === resourceId).sort((a, b) => a.start.getTime() - b.start.getTime());
    if (resourceOps.length === 0) return `${resourceId} 当前方案中没有排产任务。`;
    return [
      `${resourceId} 当前有 ${resourceOps.length} 道工序：`,
      ...resourceOps.slice(0, 8).map((op) => `- ${op.orderId} / ${op.partId} / ${op.operationName}，${formatDateTime(op.start)}-${formatDateTime(op.end)}，耗时 ${minutesToHours(op.runMinutes + op.setupMinutes)}`),
    ].join('\n');
  }

  if (orderId) {
    const orderOps = plan.operations.filter((op) => op.orderId === orderId).sort((a, b) => a.start.getTime() - b.start.getTime());
    if (orderOps.length === 0) return `当前方案中没有 ${orderId}，请确认是否已导入该订单。`;
    const delayText = explainOrderDelay(plan, orderId);
    const route = orderOps.map((op) => `${op.operationSeq}/${op.operationName}@${op.resourceId} ${formatDateTime(op.start)}-${formatDateTime(op.end)}`).join('；');
    return `${delayText}\n工序流转：${route}`;
  }

  if (text.includes('风险') || text.includes('延期订单') || text.includes('哪些订单')) {
    if (delayed.length === 0) return `当前方案无延期订单，准交率 ${plan.kpi.onTimeRate}%。`;
    return delayed.slice(0, 5).map((op, index) => `${index + 1}. ${op.orderId} / ${op.partId} / ${op.operationName}，延期 ${minutesToHours(op.delayMinutes)}，设备 ${op.resourceId}。`).join('\n');
  }

  return `当前方案准交率 ${plan.kpi.onTimeRate}%，延期订单 ${plan.kpi.delayedOrders} 个，瓶颈设备 ${plan.kpi.bottleneckResource}。你可以继续输入订单号、设备号，或问“哪些订单有延期风险”。`;
};

const summarizePlanForAgent = (plan: SchedulePlan) => ({
  planName: plan.name,
  objective: plan.objective,
  kpi: plan.kpi,
  operations: plan.operations.slice(0, 80).map((op) => ({
    orderId: op.orderId,
    customer: op.customer,
    partId: op.partId,
    operationSeq: op.operationSeq,
    operationName: op.operationName,
    resourceId: op.resourceId,
    start: formatDateTime(op.start),
    end: formatDateTime(op.end),
    durationHours: Number(((op.runMinutes + op.setupMinutes) / 60).toFixed(1)),
    delayHours: Number((op.delayMinutes / 60).toFixed(1)),
    delayReason: op.delayReason,
  })),
});

const askDeepSeek = async (question: string, plan: SchedulePlan, config?: ModelConfig) => {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      plan: summarizePlanForAgent(plan),
      ...(config ? { config } : {}),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? 'DeepSeek 服务暂不可用');
  }
  const data = await response.json();
  return data.content as string;
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const loadTrialAuth = (): TrialAuth | null => {
  try {
    const stored = localStorage.getItem(authStorageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as TrialAuth;
    return parsed.email && parsed.inviteCode ? parsed : null;
  } catch {
    localStorage.removeItem(authStorageKey);
    return null;
  }
};

const isVerificationPassed = (payload: unknown) => {
  if (payload === true) return true;
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Record<string, unknown>;
  const nested = typeof data.data === 'object' && data.data ? (data.data as Record<string, unknown>) : {};
  const code = data.code ?? nested.code;
  return (
    data.ok === true ||
    data.success === true ||
    data.valid === true ||
    data.authorized === true ||
    code === 0 ||
    code === '0' ||
    code === 200 ||
    code === '200' ||
    nested.ok === true ||
    nested.success === true ||
    nested.valid === true ||
    nested.authorized === true
  );
};

const normalizeVerifyPayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return payload;
  const data = payload as Record<string, unknown>;
  if (typeof data.body !== 'string') return payload;
  try {
    return JSON.parse(data.body);
  } catch {
    return payload;
  }
};

const getVerifyMessage = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return '邀请码或邮箱未通过验证';
  const data = payload as Record<string, unknown>;
  const nested = typeof data.data === 'object' && data.data ? (data.data as Record<string, unknown>) : {};
  return typeof data.message === 'string'
    ? data.message
    : typeof nested.message === 'string'
      ? nested.message
      : '邀请码或邮箱未通过验证';
};

const verifyInvite = async (email: string, inviteCode: string, action: 'bindInvite' | 'checkAccess' = 'bindInvite') => {
  const response = await fetch(inviteVerifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      email,
      userEmail: email,
      ...(action === 'bindInvite' ? { inviteCode, code: inviteCode } : {}),
    }),
  });
  const text = await response.text();
  const rawPayload = text ? JSON.parse(text) : {};
  const payload = normalizeVerifyPayload(rawPayload);
  if (!response.ok || !isVerificationPassed(payload)) {
    throw new Error(getVerifyMessage(payload));
  }
};

function AuthGate({ onVerified }: { onVerified: (auth: TrialAuth) => void }) {
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [status, setStatus] = useState('请输入邮箱和邀请码，通过验证后进入试用。');
  const [isChecking, setIsChecking] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedInviteCode = inviteCode.trim();
    if (!isValidEmail(normalizedEmail)) {
      setStatus('请先输入有效邮箱。');
      return;
    }
    if (!normalizedInviteCode) {
      setStatus('请输入邀请码。');
      return;
    }
    setIsChecking(true);
    setStatus('正在校验试用资格...');
    try {
      await verifyInvite(normalizedEmail, normalizedInviteCode);
      const auth = {
        email: normalizedEmail,
        inviteCode: normalizedInviteCode,
        verifiedAt: new Date().toISOString(),
      };
      localStorage.setItem(authStorageKey, JSON.stringify(auth));
      onVerified(auth);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '验证失败，请确认邮箱和邀请码，或前往产品中心申请。');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="auth-mark"><Factory size={24} /></div>
          <div>
            <div className="eyebrow">PEBS APS AI</div>
            <h1>试用资格验证</h1>
            <p>使用排产智能体前，需要输入已授权的邀请码和邮箱。</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span><Mail size={16} />邮箱</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              placeholder="name@company.com"
              onChange={(event) => setEmail(event.target.value)}
              disabled={isChecking}
            />
          </label>
          <label>
            <span><KeyRound size={16} />邀请码</span>
            <input
              value={inviteCode}
              autoComplete="one-time-code"
              placeholder="请输入邀请码"
              onChange={(event) => setInviteCode(event.target.value)}
              disabled={isChecking}
            />
          </label>
          <button className="primary auth-submit" disabled={isChecking}>
            <LogIn size={17} />{isChecking ? '验证中...' : '进入试用'}
          </button>
          <button type="button" className="secondary auth-submit" disabled={isChecking} onClick={() => window.location.assign(authRedirectUrl)}>
            申请或查看邀请码
          </button>
          <p className="auth-status">{status}</p>
        </form>
      </section>
    </main>
  );
}

function AuthLoading() {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="auth-mark"><Factory size={24} /></div>
          <div>
            <div className="eyebrow">PEBS APS AI</div>
            <h1>正在验证试用资格</h1>
            <p>系统正在通过云函数确认邀请码和邮箱。</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function DataPanel({
  orders,
  resources,
  routings,
  scheduledOperations,
  onImportOrders,
  onImportResources,
  onImportRoutings,
  disabled,
  onConsumeRun,
  activeImportKind,
  onActiveImportKindChange,
  mode,
  workspace,
  onLoadSimulationData,
  onLoadSimulationDataForScenario,
  onExecuteScenario,
}: {
  orders: Order[];
  resources: Resource[];
  routings: Routing[];
  scheduledOperations: number;
  onImportOrders: (rows: Order[]) => void;
  onImportResources: (rows: Resource[]) => void;
  onImportRoutings: (rows: Routing[]) => void;
  disabled: boolean;
  onConsumeRun: (label: string) => boolean;
  activeImportKind: ImportKind;
  onActiveImportKindChange: (kind: ImportKind) => void;
  mode: WorkspaceMode;
  workspace: { title: string; desc: string };
  onLoadSimulationData: () => void;
  onLoadSimulationDataForScenario: (action: ScenarioAction) => void;
  onExecuteScenario: (action: ScenarioAction) => void;
}) {
  const kind = activeImportKind;
  const isSampleMode = mode === 'sample-data';
  const isImportMode = mode === 'import-orders' || mode === 'import-routings' || mode === 'import-resources';
  const scenario = mode === 'urgent' || mode === 'stop' || mode === 'shortage' ? scenarioCopy[mode] : null;
  const scenarioAction = scenario ? (mode as ScenarioAction) : null;
  const dataReady = orders.length > 0 && resources.length > 0 && routings.length > 0 && scheduledOperations > 0;
  const [csvText, setCsvText] = useState(csvExamples.orders);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [importMessage, setImportMessage] = useState('当前使用内置样例数据，可粘贴 CSV 覆盖试排。');
  const preview = useMemo(() => parseCsv(csvText), [csvText]);
  const [mapping, setMapping] = useState<FieldMapping>(() => suggestMapping('orders', parseCsv(csvExamples.orders).headers));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyImport = () => {
    if (disabled) return;
    const result = parseByKindWithMapping(kind, preview.records, mapping);
    setIssues(result.issues);
    if (result.issues.length > 0) {
      setImportMessage(`导入失败：请先修正 ${result.issues.length} 个数据问题。`);
      return;
    }
    if (!onConsumeRun('导入数据并重排')) return;
    if (kind === 'orders') {
      const rows = result.rows as Order[];
      if (rows.length > trialState.maxOrders) {
        setIssues([{ row: 0, message: `试用版最多允许 ${trialState.maxOrders} 个订单` }]);
        return;
      }
      onImportOrders(rows);
    }
    if (kind === 'resources') {
      const rows = result.rows as Resource[];
      if (rows.length > trialState.maxResources) {
        setIssues([{ row: 0, message: `试用版最多允许 ${trialState.maxResources} 台设备` }]);
        return;
      }
      onImportResources(rows);
    }
    if (kind === 'routings') {
      onImportRoutings(result.rows as Routing[]);
    }
    setImportMessage(`已导入 ${result.rows.length} 条${importKindLabel[kind]}数据，并自动刷新排产方案。`);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setIssues([]);
    const parsed = parseCsv(text);
    setMapping(suggestMapping(kind, parsed.headers));
    setImportMessage(`已读取文件 ${file.name}，识别到 ${parsed.headers.length} 个字段，请确认映射后应用导入。`);
    event.target.value = '';
  };

  const loadExample = (nextKind: ImportKind) => {
    onActiveImportKindChange(nextKind);
    setCsvText(csvExamples[nextKind]);
    setMapping(suggestMapping(nextKind, parseCsv(csvExamples[nextKind]).headers));
    setIssues([]);
    setImportMessage(`已切换到${importKindLabel[nextKind]}模板。`);
  };

  useEffect(() => {
    setMapping(suggestMapping(kind, preview.headers));
  }, [kind, csvText]);

  const matchedRequired = fieldDefinitions[kind].filter((field) => field.required && mapping[field.key]).length;
  const requiredCount = fieldDefinitions[kind].filter((field) => field.required).length;

  return (
    <section className="panel data-panel">
      <div className="panel-head">
        <div>
          <h2>{workspace.title}</h2>
          <p>{workspace.desc}</p>
        </div>
        {isImportMode && (
          <button className="icon-button" title="上传 CSV 文件" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />
          </button>
        )}
      </div>
      <div className="data-grid">
        <div><strong>{orders.length}</strong><span>订单</span></div>
        <div><strong>{routings.length}</strong><span>工艺路线</span></div>
        <div><strong>{resources.length}</strong><span>设备资源</span></div>
        <div><strong>{sampleCalendar.length}</strong><span>班次</span></div>
        <div><strong>{sampleInventory.length}</strong><span>物料状态</span></div>
        <div><strong>{sampleWip.length}</strong><span>在制品</span></div>
      </div>
      <div className="requirements-grid">
        <div>
          <strong>必需 1：订单</strong>
          <span>订单号、零件号/料号、数量、交期</span>
        </div>
        <div>
          <strong>必需 2：工艺路线</strong>
          <span>零件号、工序序号、工序名称、可选设备、标准工时</span>
        </div>
        <div>
          <strong>必需 3：设备资源</strong>
          <span>设备编号、设备名称、班次日历、设备能力</span>
        </div>
        <div>
          <strong>可选增强</strong>
          <span>班次、物料齐套、在制品、停机计划、工装夹具</span>
        </div>
      </div>
      {isSampleMode && (
        <div className="sample-data-box">
          <div>
            <strong>模拟数据包</strong>
            <span>包含订单、工艺路线、设备资源三份 CSV，可下载查看，也可一键载入当前试排。</span>
          </div>
          <div className="sample-actions">
            <button onClick={() => downloadTextFile('simulation_orders.csv', simulationCsv.orders)}>下载订单 CSV</button>
            <button onClick={() => downloadTextFile('simulation_routings.csv', simulationCsv.routings)}>下载工艺 CSV</button>
            <button onClick={() => downloadTextFile('simulation_resources.csv', simulationCsv.resources)}>下载设备 CSV</button>
            <button className="primary" disabled={disabled} onClick={onLoadSimulationData}>一键载入模拟数据</button>
          </div>
        </div>
      )}
      {scenario && (
        <div className="scenario-box">
          <div className="scenario-head">
            <div>
              <strong>{scenario.title}</strong>
              <span>先确认本次模拟会改变哪些输入，再执行有限产能重排。</span>
            </div>
            <button className="primary" disabled={disabled} onClick={() => onExecuteScenario(mode as ScenarioAction)}>
              <RefreshCw size={16} />{scenario.button}
            </button>
          </div>
          <div className={`scenario-check ${dataReady ? 'ready' : 'warning'}`}>
            <div>
              <strong>数据检测</strong>
              <span>
                当前数据：{orders.length} 个订单 / {routings.length} 条工艺 / {resources.length} 台设备 / 可排工序 {scheduledOperations} 道。
                {dataReady ? '可以执行本场景重排。' : '当前数据不足或无法生成排产，建议先载入模拟数据检测。'}
              </span>
            </div>
            {scenarioAction && (
              <button disabled={disabled} onClick={() => onLoadSimulationDataForScenario(scenarioAction)}>
                载入模拟数据并检测
              </button>
            )}
          </div>
          <div className="scenario-grid">
            <div>
              <strong>输入变化</strong>
              {scenario.input.map((item) => <span key={item}>{item}</span>)}
            </div>
            <div>
              <strong>重排计算</strong>
              {scenario.calculation.map((item) => <span key={item}>{item}</span>)}
            </div>
            <div>
              <strong>结果观察</strong>
              {scenario.observe.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </div>
      )}
      {isImportMode && (
        <>
          <div className="import-box">
            <input ref={fileInputRef} className="file-input" type="file" accept=".csv,text/csv" onChange={handleFileChange} />
            <div className="segmented">
              {(['orders', 'routings', 'resources'] as ImportKind[]).map((item) => (
                <button key={item} className={kind === item ? 'active' : ''} disabled={disabled} onClick={() => loadExample(item)}>
                  {importKindLabel[item]}
                </button>
              ))}
            </div>
            <textarea
              className="csv-input"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              disabled={disabled}
              spellCheck={false}
              aria-label="CSV 数据"
            />
            <div className="mapping-head">
              <strong>字段智能匹配</strong>
              <span>识别字段 {preview.headers.length} 个，必填匹配 {matchedRequired}/{requiredCount}</span>
            </div>
            <div className="mapping-grid">
              {fieldDefinitions[kind].map((field) => (
                <label key={field.key} className={field.required && !mapping[field.key] ? 'missing' : ''}>
                  <span>{field.label}{field.required ? ' *' : ''}</span>
                  <select
                    value={mapping[field.key] ?? ''}
                    disabled={disabled}
                    onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}
                  >
                    <option value="">不导入/待补充</option>
                    {preview.headers.map((header) => (
                      <option value={header} key={header}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="import-actions">
              <button className="primary" disabled={disabled} onClick={applyImport}><Upload size={16} />应用导入</button>
              <span>{disabled ? '试用已到期或今日排产次数已用完，导入重排已锁定。' : importMessage}</span>
            </div>
          </div>
          <div className="validation-list">
            {issues.length === 0 ? (
              <>
                <div><CheckCircle2 size={16} />必填字段校验通过</div>
                <div><CheckCircle2 size={16} />工艺路线可展开为生产任务</div>
                <div><AlertTriangle size={16} />1 条物料状态显示缺料，将进入风险列表</div>
              </>
            ) : (
              issues.slice(0, 4).map((issue) => (
                <div className="issue" key={`${issue.row}-${issue.message}`}>
                  <AlertTriangle size={16} />第 {issue.row} 行：{issue.message}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

function TablePreview({ rows, emptyText }: { rows: XlsxRow[]; emptyText: string }) {
  const columns = Object.keys(rows[0] ?? {});
  if (rows.length === 0 || columns.length === 0) {
    return <div className="empty-state">{emptyText}</div>;
  }
  return (
    <div className="operation-table-wrap plan-preview-wrap">
      <table className="operation-table plan-preview-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => <td key={column}>{row[column]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Gantt({
  plan,
  orders,
  onExportReport,
  onExportAllXlsx,
  onExportSchedule,
  onExportMaterialInspection,
  onExportMaterialDelivery,
}: {
  plan: SchedulePlan;
  orders: Order[];
  onExportReport: () => void;
  onExportAllXlsx: () => void;
  onExportSchedule: () => void;
  onExportMaterialInspection: () => void;
  onExportMaterialDelivery: () => void;
}) {
  const [selectedOp, setSelectedOp] = useState<ScheduledOperation | null>(null);
  const [groupMode, setGroupMode] = useState<OperationGroupMode>('resource');
  const [sequenceView, setSequenceView] = useState<SequenceViewMode>('operations');
  const resources = [...new Set(plan.operations.map((op) => op.resourceId))];
  const groupedOperations = useMemo(() => groupOperations(plan.operations, groupMode), [plan.operations, groupMode]);
  const inspectionRows = useMemo(() => materialInspectionRows(plan, orders), [plan, orders]);
  const deliveryRows = useMemo(() => materialDeliveryRows(plan, orders), [plan, orders]);
  useEffect(() => {
    setSelectedOp(plan.operations[0] ?? null);
    setSequenceView('operations');
  }, [plan.id]);
  if (plan.operations.length === 0) {
    return (
      <section className="panel gantt-panel">
        <div className="panel-head">
          <div>
            <h2>排产甘特图</h2>
            <p>{plan.name}，目标函数：{plan.objective}</p>
          </div>
        </div>
        <div className="empty-state">当前数据无法生成排产任务，请检查订单、工艺路线和设备资源是否匹配。</div>
      </section>
    );
  }
  const start = Math.min(...plan.operations.map((op) => op.start.getTime()));
  const end = Math.max(...plan.operations.map((op) => op.end.getTime()));
  const span = Math.max(1, end - start);

  return (
    <section className="panel gantt-panel">
      <div className="panel-head">
        <div>
          <h2>排产甘特图</h2>
          <p>{plan.name}，目标函数：{plan.objective}</p>
        </div>
        <div className="panel-actions">
          <button className="primary" onClick={onExportAllXlsx}><FileDown size={16} />导出全部XLSX</button>
          <button className="secondary" onClick={onExportSchedule}><FileDown size={16} />导出排产计划</button>
          <button className="secondary" onClick={onExportReport}><FileDown size={16} />导出试用报告</button>
        </div>
      </div>
      <div className="gantt">
        {resources.map((resourceId) => (
          <div className="gantt-row" key={resourceId}>
            <div className="gantt-resource">{resourceId}</div>
            <div className="gantt-lane">
              {plan.operations.filter((op) => op.resourceId === resourceId).map((op) => {
                const left = ((op.start.getTime() - start) / span) * 100;
                const width = Math.max(4, ((op.end.getTime() - op.start.getTime()) / span) * 100);
                return (
                  <button
                    key={op.id}
                    className={`gantt-task ${op.delayMinutes > 0 ? 'delayed' : ''} ${selectedOp?.id === op.id ? 'selected' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${op.orderId} ${op.operationName} ${formatDateTime(op.start)}-${formatDateTime(op.end)}`}
                    onClick={() => setSelectedOp(op)}
                  >
                    <span>{op.orderId.replace('SO-202605', '#')} / {op.operationName}</span>
                    <small>{formatDateTime(op.start)}-{formatDateTime(op.end)} · {minutesToHours(op.runMinutes + op.setupMinutes)}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {selectedOp && (
        <div className="operation-detail">
          <div>
            <span>订单</span>
            <strong>{selectedOp.orderId}</strong>
          </div>
          <div>
            <span>工序</span>
            <strong>{selectedOp.operationSeq} / {selectedOp.operationName}</strong>
          </div>
          <div>
            <span>设备</span>
            <strong>{selectedOp.resourceId}</strong>
          </div>
          <div>
            <span>开始</span>
            <strong>{formatDateTime(selectedOp.start)}</strong>
          </div>
          <div>
            <span>结束</span>
            <strong>{formatDateTime(selectedOp.end)}</strong>
          </div>
          <div>
            <span>工序耗时</span>
            <strong>{minutesToHours(selectedOp.runMinutes + selectedOp.setupMinutes)}</strong>
          </div>
        </div>
      )}
      <div className="operation-sequence-head">
        <div>
          <h3>加工时序分组视图</h3>
          <p>按设备查看每台设备上的订单和零件，或按订单、零件追踪工序流转。</p>
        </div>
        <div className="segmented compact">
          {(['resource', 'order', 'part'] as OperationGroupMode[]).map((mode) => (
            <button
              key={mode}
              className={sequenceView === 'operations' && groupMode === mode ? 'active' : ''}
              onClick={() => {
                setGroupMode(mode);
                setSequenceView('operations');
              }}
            >
              {operationGroupLabel[mode]}
            </button>
          ))}
        </div>
        <div className="sequence-actions">
          <button onClick={onExportSchedule}><FileDown size={14} />导出加工时序</button>
          <button className={sequenceView === 'material-inspection' ? 'active' : ''} onClick={() => setSequenceView('material-inspection')}>物料检查计划表</button>
          <button className={sequenceView === 'material-delivery' ? 'active' : ''} onClick={() => setSequenceView('material-delivery')}>物料配送计划表</button>
        </div>
      </div>
      {sequenceView === 'operations' && (
        <div className="operation-groups">
          {groupedOperations.map((group) => (
            <div className="operation-group" key={group.key}>
              <div className="operation-group-title">
                <strong>{operationGroupLabel[groupMode]}：{group.key}</strong>
                <span>{group.items.length} 道工序 / 总耗时 {minutesToHours(group.totalMinutes)}</span>
              </div>
              <div className="operation-table-wrap">
                <table className="operation-table">
                  <thead>
                    <tr>
                      <th>设备</th>
                      <th>订单</th>
                      <th>零件</th>
                      <th>工序</th>
                      <th>开始</th>
                      <th>结束</th>
                      <th>耗时</th>
                      <th>延期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((op) => (
                      <tr key={op.id} className={selectedOp?.id === op.id ? 'selected-row' : ''} onClick={() => setSelectedOp(op)}>
                        <td>{op.resourceId}</td>
                        <td>{op.orderId}</td>
                        <td>{op.partId}</td>
                        <td>{op.operationSeq} / {op.operationName}</td>
                        <td>{formatDateTime(op.start)}</td>
                        <td>{formatDateTime(op.end)}</td>
                        <td>{minutesToHours(op.runMinutes + op.setupMinutes)}</td>
                        <td>{op.delayMinutes > 0 ? minutesToHours(op.delayMinutes) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      {sequenceView === 'material-inspection' && (
        <div className="plan-preview">
          <div className="plan-preview-head">
            <div>
              <h3>物料检查计划表</h3>
              <p>按订单和零件汇总所需物料，用于试用客户做齐套检查。</p>
            </div>
            <button className="primary" onClick={onExportMaterialInspection}><FileDown size={16} />导出物料检查计划表</button>
          </div>
          <TablePreview rows={inspectionRows} emptyText="当前排产结果无法生成物料检查计划表。" />
        </div>
      )}
      {sequenceView === 'material-delivery' && (
        <div className="plan-preview">
          <div className="plan-preview-head">
            <div>
              <h3>物料配送计划表</h3>
              <p>以设备为基点，按加工时序生成配送时间、最晚配送时间和订单信息。</p>
            </div>
            <button className="primary" onClick={onExportMaterialDelivery}><FileDown size={16} />导出物料配送计划表</button>
          </div>
          <TablePreview rows={deliveryRows} emptyText="当前排产结果无法生成物料配送计划表。" />
        </div>
      )}
    </section>
  );
}

function RiskPanel({ plan }: { plan: SchedulePlan }) {
  const delayed = plan.operations
    .filter((op) => op.delayMinutes > 0)
    .sort((a, b) => b.delayMinutes - a.delayMinutes)
    .slice(0, 8);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>订单风险</h2>
          <p>按延期时长排序，供计划员优先处理。</p>
        </div>
      </div>
      <div className="risk-list">
        {delayed.map((op) => (
          <div className="risk-item" key={op.id}>
            <div>
              <strong>{op.orderId}</strong>
              <span>{op.customer} / {op.partId} / {op.operationName}</span>
            </div>
            <div className="risk-delay">{minutesToHours(op.delayMinutes)}</div>
          </div>
        ))}
        {delayed.length === 0 && <div className="empty">当前方案无延期订单。</div>}
      </div>
    </section>
  );
}

function AgentPanel({
  plan,
  trialLocked,
  onAction,
  allowTrialReset,
  allowClientModelConfig,
}: {
  plan: SchedulePlan;
  trialLocked: boolean;
  onAction: (action: AgentAction) => void;
  allowTrialReset: boolean;
  allowClientModelConfig: boolean;
}) {
  const delayedOrder = plan.operations.find((op) => op.delayMinutes > 0)?.orderId ?? plan.operations[0]?.orderId;
  const defaultQuestion = delayedOrder ? `为什么 ${delayedOrder} 延期？` : '今天的瓶颈设备是什么？';
  const [question, setQuestion] = useState(defaultQuestion);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: 'assistant',
      content: '你好，我是 DeepSeek V4 排产智能体。你可以问我订单延期、设备负荷、瓶颈资源、风险清单或计划员日报。',
    },
  ]);
  const [isThinking, setIsThinking] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(loadModelConfig);
  const [configOpen, setConfigOpen] = useState(true);
  const [configStatus, setConfigStatus] = useState(modelConfig.apiKey ? '模型配置已加载。' : '尚未配置 API Key，将使用本地规则引擎降级回答。');
  const [agentStage, setAgentStage] = useState<AgentStage>('start');
  const stageTitle: Record<AgentStage, string> = {
    start: '推荐下一步',
    guide: '使用引导',
    import: '真实数据导入',
    simulate: '模拟验证',
    analysis: '结果分析',
  };
  const cardCatalog: Record<AgentAction, { action: AgentAction; title: string; desc: string; icon: React.ReactNode; disabled?: boolean }> = {
    guide: { action: 'guide', title: '开始使用', desc: '查看文件要求和推荐流程', icon: <Bot size={16} /> },
    'sample-data': { action: 'sample-data', title: '生成模拟数据', desc: '下载样例 CSV 或一键载入', icon: <Database size={16} />, disabled: trialLocked },
    'import-orders': { action: 'import-orders', title: '导入订单', desc: '订单号、零件号、数量、交期', icon: <Database size={16} />, disabled: trialLocked },
    'import-routings': { action: 'import-routings', title: '导入工艺路线', desc: '工序、可选设备、标准工时', icon: <Wrench size={16} />, disabled: trialLocked },
    'import-resources': { action: 'import-resources', title: '导入设备', desc: '设备编号、日历、能力标签', icon: <Factory size={16} />, disabled: trialLocked },
    'base-schedule': { action: 'base-schedule', title: '生成排产', desc: '重置样例并生成基础方案', icon: <Play size={16} />, disabled: trialLocked },
    urgent: { action: 'urgent', title: '插单模拟', desc: '先看场景，再确认重排', icon: <Clock3 size={16} />, disabled: trialLocked },
    stop: { action: 'stop', title: '停机模拟', desc: '先看停机约束，再确认重排', icon: <Wrench size={16} />, disabled: trialLocked },
    shortage: { action: 'shortage', title: '缺料模拟', desc: '先看缺料约束，再确认重排', icon: <AlertTriangle size={16} />, disabled: trialLocked },
    export: { action: 'export', title: '导出报告', desc: '生成试用版 POC 报告', icon: <FileDown size={16} /> },
    'reset-trial': { action: 'reset-trial', title: '重置额度', desc: '清零今日排产次数', icon: <RefreshCw size={16} /> },
  };
  const stageActions: Record<AgentStage, AgentAction[]> = {
    start: ['guide', 'sample-data', 'import-orders', 'urgent', 'export', 'reset-trial'],
    guide: ['sample-data', 'import-orders', 'import-routings', 'import-resources'],
    import: ['import-orders', 'import-routings', 'import-resources', 'base-schedule'],
    simulate: ['sample-data', 'urgent', 'stop', 'shortage', 'base-schedule'],
    analysis: ['export', 'urgent', 'stop', 'shortage', 'reset-trial'],
  };
  const actionCards = stageActions[agentStage]
    .filter((action) => allowTrialReset || action !== 'reset-trial')
    .map((action) => cardCatalog[action]);
  useEffect(() => {
    setQuestion(delayedOrder ? `为什么 ${delayedOrder} 延期？` : '今天的瓶颈设备是什么？');
  }, [delayedOrder, plan.id]);

  const saveModelConfig = () => {
    localStorage.setItem('pebs-aps-ai-model-config', JSON.stringify(modelConfig));
    setConfigStatus(`已保存 ${modelConfig.model} 配置。`);
  };

  const testModelConfig = async () => {
    saveModelConfig();
    setConfigStatus('正在测试模型连接...');
    try {
      await askDeepSeek('请用一句话回复：模型连接成功。', plan, allowClientModelConfig ? modelConfig : undefined);
      setConfigStatus(`${modelConfig.model} 连接成功，可以用于对话。`);
    } catch (error) {
      setConfigStatus(error instanceof Error ? `连接失败：${error.message}` : '连接失败：未知错误');
    }
  };

  const sendQuestion = async (nextQuestion = question) => {
    const trimmed = nextQuestion.trim();
    if (!trimmed || isThinking) return;
    setAgentStage(detectAgentStage(trimmed));
    const userMessage: ChatMessage = { id: createId(), role: 'user', content: trimmed };
    setMessages((current) => [...current, userMessage]);
    setQuestion('');
    setIsThinking(true);
    try {
      const reply = await askDeepSeek(trimmed, plan, allowClientModelConfig ? modelConfig : undefined);
      setMessages((current) => [...current, { id: createId(), role: 'assistant', content: reply }]);
    } catch (error) {
      const fallback = buildAgentReply(trimmed, plan);
      const suffix = error instanceof Error ? `\n\nDeepSeek V4 暂未接通：${error.message}。以上为本地排产规则引擎回答。` : '';
      setMessages((current) => [...current, { id: createId(), role: 'assistant', content: `${fallback}${suffix}` }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <section className="panel agent-panel">
      <div className="panel-head">
        <div>
          <h2>AI 排产智能体</h2>
          <p>基于真实排产结果解释延期、瓶颈和重排影响。</p>
        </div>
        <Bot size={22} />
      </div>
      <div className="agent-actions">
        <div className="agent-actions-title">
          <strong>{stageTitle[agentStage]}</strong>
          <span>卡片会根据你的对话意图变化</span>
        </div>
        {actionCards.map((card) => (
          <button
            key={card.action}
            disabled={card.disabled}
            onClick={() => {
              setAgentStage(detectAgentStage(`${card.title} ${card.desc}`));
              onAction(card.action);
            }}
          >
            <span>{card.icon}</span>
            <strong>{card.title}</strong>
            <small>{card.desc}</small>
          </button>
        ))}
      </div>
      <div className="model-config">
        {allowClientModelConfig ? (
          <>
            <button className="config-toggle" onClick={() => setConfigOpen((current) => !current)}>
              大模型配置：{modelConfig.model}
            </button>
            {configOpen && (
          <div className="model-config-body">
            <label>
              <span>供应商</span>
              <select value={modelConfig.provider} onChange={(event) => setModelConfig((current) => ({ ...current, provider: event.target.value as 'deepseek' }))}>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>
            <label>
              <span>模型</span>
              <select value={modelConfig.model} onChange={(event) => setModelConfig((current) => ({ ...current, model: event.target.value }))}>
                <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                <option value="deepseek-v4-flash">deepseek-v4-flash</option>
              </select>
            </label>
            <label>
              <span>Base URL</span>
              <input value={modelConfig.baseUrl} onChange={(event) => setModelConfig((current) => ({ ...current, baseUrl: event.target.value }))} />
            </label>
            <label>
              <span>API Key</span>
              <input
                type="password"
                value={modelConfig.apiKey}
                placeholder="sk-..."
                onChange={(event) => setModelConfig((current) => ({ ...current, apiKey: event.target.value }))}
              />
            </label>
            <div className="config-actions">
              <button onClick={saveModelConfig}>保存配置</button>
              <button className="primary" onClick={() => void testModelConfig()}>测试连接</button>
            </div>
            <p>{configStatus}</p>
          </div>
            )}
          </>
        ) : (
          <div className="model-config-body">
            <p>大模型由服务端统一配置。客户试用环境不会暴露 API Key，也不能切换模型额度来源。</p>
          </div>
        )}
      </div>
      <div className="quick-prompts">
        <button onClick={() => sendQuestion('今天的瓶颈设备是什么？')}>瓶颈设备</button>
        <button onClick={() => sendQuestion(delayedOrder ? `为什么 ${delayedOrder} 延期？` : '哪些订单有延期风险？')}>延期原因</button>
        <button onClick={() => sendQuestion('生成计划员日报')}>计划员日报</button>
      </div>
      <div className="chat-log">
        {messages.map((message) => (
          <div className={`chat-message ${message.role}`} key={message.id}>
            <span>{message.role === 'user' ? '你' : '智能体'}</span>
            <p>{message.content}</p>
          </div>
        ))}
        {isThinking && <div className="chat-message assistant"><span>智能体</span><p>DeepSeek V4 正在分析当前排产方案...</p></div>}
      </div>
      <div className="chat-input-row">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void sendQuestion();
            }
          }}
          placeholder={defaultQuestion}
        />
        <button className="primary" disabled={isThinking} onClick={() => void sendQuestion()}>发送</button>
      </div>
    </section>
  );
}

function App() {
  const [orders, setOrders] = useState(sampleOrders);
  const [resources, setResources] = useState(sampleResources);
  const [routings, setRoutings] = useState(sampleRoutings);
  const [activeImportKind, setActiveImportKind] = useState<ImportKind>('orders');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('guide');
  const [unavailable, setUnavailable] = useState<{ resourceId: string; start: Date; end: Date }[]>([]);
  const [materialHolds, setMaterialHolds] = useState<{ orderId: string; availableAt: Date; reason: string }[]>([]);
  const [planName, setPlanName] = useState('基础排产方案');
  const [runsToday, setRunsToday] = useState(getInitialRuns);
  const [trialNotice, setTrialNotice] = useState('试用环境已启用，可导入数据或运行重排场景。');
  const trialLocked = daysLeft() <= 0 || runsToday >= trialState.dailyRunsLimit;
  const plan = useMemo(
    () => runSchedule({ orders, routings, resources, calendar: sampleCalendar, wip: sampleWip, planName, unavailable, materialHolds }),
    [orders, resources, routings, unavailable, materialHolds, planName],
  );

  useEffect(() => {
    localStorage.setItem('pebs-aps-ai-runs', String(runsToday));
  }, [runsToday]);

  const consumeRun = (label: string) => {
    if (trialLocked) {
      setTrialNotice('试用已到期或今日排产次数已用完，请联系项目顾问开通付费 POC。');
      return false;
    }
    setRunsToday((current) => current + 1);
    setTrialNotice(`${label}已执行，本次操作消耗 1 次试用排产额度。`);
    return true;
  };

  const addUrgent = () => {
    if (!consumeRun('急单重排')) return;
    setOrders((current) => [makeUrgentOrder(), ...current]);
    setPlanName('急单插入重排方案');
    setTrialNotice('已执行插单重排：新增高优先级急单，并重新计算所有工序的设备占用、开始时间和延期风险。');
  };

  const stopMachine = () => {
    if (!consumeRun('设备停机重排')) return;
    setUnavailable([{ resourceId: 'CNC-08', start: new Date('2026-05-12T13:00:00'), end: new Date('2026-05-13T10:00:00') }]);
    setPlanName('CNC-08 停机重排方案');
    setTrialNotice('已执行停机重排：CNC-08 停机窗口已加入约束，系统重新寻找可用设备和时间窗口。');
  };

  const simulateShortage = () => {
    if (!consumeRun('缺料影响重排')) return;
    setMaterialHolds([{ orderId: 'SO-202605002', availableAt: new Date('2026-05-13T10:00:00'), reason: '关键物料 M-B002 缺料，预计 05/13 10:00 到料后才能开工' }]);
    setPlanName('缺料影响重排方案');
    setTrialNotice('已执行缺料重排：SO-202605002 增加最早开工时间约束，并刷新甘特图和风险原因。');
  };

  const reset = () => {
    if (!consumeRun('基础排产')) return;
    setOrders(sampleOrders);
    setResources(sampleResources);
    setRoutings(sampleRoutings);
    setUnavailable([]);
    setMaterialHolds([]);
    setPlanName('基础排产方案');
  };

  const exportReport = () => {
    downloadTextFile(`PEBS-APS-AI-${plan.name}.md`, buildTrialReport(plan));
    setTrialNotice('已导出试用版 POC 报告，报告包含试用声明和关键 KPI。');
  };

  const exportScheduleXlsx = () => {
    exportScheduleWorkbook(plan);
    setTrialNotice('已导出排产计划表 XLSX，包含按设备、按订单、按零件 3 个工作表。');
  };

  const exportMaterialInspectionXlsx = () => {
    exportMaterialInspectionWorkbook(plan, orders);
    setTrialNotice('已导出物料检查计划表 XLSX，可用于试用客户做齐套检查。');
  };

  const exportMaterialDeliveryXlsx = () => {
    exportMaterialDeliveryWorkbook(plan, orders);
    setTrialNotice('已导出物料配送计划表 XLSX，已按设备加工时序生成配送时间和最晚配送时间。');
  };

  const exportAllXlsx = () => {
    exportScheduleWorkbook(plan);
    exportMaterialInspectionWorkbook(plan, orders);
    exportMaterialDeliveryWorkbook(plan, orders);
    setTrialNotice('已分别导出排产计划表、物料检查计划表、物料配送计划表 3 个 XLSX 文件。');
  };

  const resetTrialRuns = () => {
    localStorage.setItem('pebs-aps-ai-runs-version', trialStorageVersion);
    localStorage.setItem('pebs-aps-ai-runs', '0');
    setRunsToday(0);
    setWorkspaceMode('reset-trial');
    setTrialNotice('今日排产次数已清零，可以继续测试导入、模拟数据和重排场景。');
  };

  const focusImport = (kind: ImportKind) => {
    setActiveImportKind(kind);
    setWorkspaceMode(kind === 'orders' ? 'import-orders' : kind === 'routings' ? 'import-routings' : 'import-resources');
    document.querySelector('.data-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTrialNotice(`已切换到${importKindLabel[kind]}导入，请粘贴 CSV 或上传文件，确认字段匹配后应用导入。`);
  };

  const applySimulationData = (nextPlanName: string) => {
    setOrders(parseByKindWithMapping('orders', parseCsv(simulationCsv.orders).records, suggestMapping('orders', parseCsv(simulationCsv.orders).headers)).rows as Order[]);
    setRoutings(parseByKindWithMapping('routings', parseCsv(simulationCsv.routings).records, suggestMapping('routings', parseCsv(simulationCsv.routings).headers)).rows as Routing[]);
    setResources(parseByKindWithMapping('resources', parseCsv(simulationCsv.resources).records, suggestMapping('resources', parseCsv(simulationCsv.resources).headers)).rows as Resource[]);
    setUnavailable([]);
    setMaterialHolds([]);
    setPlanName(nextPlanName);
  };

  const loadSimulationData = () => {
    if (!consumeRun('载入模拟数据并排产')) return;
    applySimulationData('模拟数据排产方案');
    setTrialNotice('已载入模拟订单、工艺路线和设备资源，并生成模拟排产方案。');
  };

  const loadSimulationDataForScenario = (action: ScenarioAction) => {
    applySimulationData(`${workspaceCopy[action].title}模拟数据检测方案`);
    setWorkspaceMode(action);
    setTrialNotice(`已载入模拟数据并完成${workspaceCopy[action].title}前置检测：订单、工艺路线、设备均可生成排产。请确认场景说明后执行重排。`);
  };

  const executeScenario = (action: ScenarioAction) => {
    if (plan.operations.length === 0) {
      setWorkspaceMode(action);
      setTrialNotice('当前数据无法生成可排工序，请先在场景卡片中载入模拟数据并检测，或导入完整的订单、工艺路线和设备数据。');
      return;
    }
    if (action === 'urgent') return addUrgent();
    if (action === 'stop') return stopMachine();
    return simulateShortage();
  };

  const handleAgentAction = (action: AgentAction) => {
    setWorkspaceMode(action);
    if (action === 'guide') {
      setTrialNotice('使用本智能体至少需要导入订单、工艺路线、设备资源三类文件；班次、物料、在制品可后续补充。');
      return;
    }
    if (action === 'sample-data') {
      document.querySelector('.data-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTrialNotice('已打开模拟数据区，可下载 CSV 查看，也可一键载入模拟数据试排。');
      return;
    }
    if (action === 'import-orders') return focusImport('orders');
    if (action === 'import-routings') return focusImport('routings');
    if (action === 'import-resources') return focusImport('resources');
    if (action === 'base-schedule') return reset();
    if (action === 'urgent' || action === 'stop' || action === 'shortage') {
      document.querySelector('.data-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTrialNotice(`已打开${workspaceCopy[action].title}说明，请确认输入变化和计算逻辑后再执行重排。`);
      return;
    }
    if (action === 'export') return exportReport();
    if (action === 'reset-trial') return resetTrialRuns();
  };

  return (
    <main className="app-shell">
      <TrialBar runsToday={runsToday} locked={trialLocked} />

      <div className={`trial-notice ${trialLocked ? 'locked' : ''}`}>
        <ShieldAlert size={16} />
        <span>{trialLocked ? '试用已锁定：到期或今日排产额度用尽。历史方案可查看，新增导入和重排已禁用。' : `${trialNotice} 主要操作请从右侧智能体卡片开始。`}</span>
        {trialLocked && enableTrialReset && <button className="notice-action" onClick={resetTrialRuns}>清零今日次数</button>}
      </div>

      <section className="kpi-grid">
        <KpiCard icon={<Gauge size={20} />} label="准交率" value={`${plan.kpi.onTimeRate}%`} tone="green" />
        <KpiCard icon={<AlertTriangle size={20} />} label="延期订单" value={`${plan.kpi.delayedOrders}/${plan.kpi.totalOrders}`} tone="red" />
        <KpiCard icon={<Factory size={20} />} label="瓶颈设备" value={plan.kpi.bottleneckResource} />
        <KpiCard icon={<Clock3 size={20} />} label="平均延期" value={`${plan.kpi.avgDelayHours}h`} />
      </section>

      <section className="layout">
        <div className="left-column">
          <DataPanel
            orders={orders}
            resources={resources}
            routings={routings}
            scheduledOperations={plan.operations.length}
            disabled={trialLocked}
            onConsumeRun={consumeRun}
            activeImportKind={activeImportKind}
            onActiveImportKindChange={setActiveImportKind}
            mode={workspaceMode}
            workspace={workspaceCopy[workspaceMode]}
            onLoadSimulationData={loadSimulationData}
            onLoadSimulationDataForScenario={loadSimulationDataForScenario}
            onExecuteScenario={executeScenario}
            onImportOrders={(rows) => {
              setOrders(rows);
              setPlanName('客户订单导入排产方案');
            }}
            onImportResources={(rows) => {
              setResources(rows);
              setPlanName('客户设备导入排产方案');
            }}
            onImportRoutings={(rows) => {
              setRoutings(rows);
              setPlanName('客户工艺导入排产方案');
            }}
          />
          <Gantt
            plan={plan}
            orders={orders}
            onExportReport={exportReport}
            onExportAllXlsx={exportAllXlsx}
            onExportSchedule={exportScheduleXlsx}
            onExportMaterialInspection={exportMaterialInspectionXlsx}
            onExportMaterialDelivery={exportMaterialDeliveryXlsx}
          />
        </div>
        <div className="right-column">
          <RiskPanel plan={plan} />
          <AgentPanel
            plan={plan}
            trialLocked={trialLocked}
            onAction={handleAgentAction}
            allowTrialReset={enableTrialReset}
            allowClientModelConfig={enableClientModelConfig}
          />
        </div>
      </section>
    </main>
  );
}

function Root() {
  const [trialAuth, setTrialAuth] = useState<TrialAuth | null>(null);
  const [isCheckingStoredAuth, setIsCheckingStoredAuth] = useState(true);

  useEffect(() => {
    const storedAuth = loadTrialAuth();
    if (!storedAuth) {
      setIsCheckingStoredAuth(false);
      return;
    }
    verifyInvite(storedAuth.email, storedAuth.inviteCode, 'checkAccess')
      .then(() => setTrialAuth(storedAuth))
      .catch(() => {
        localStorage.removeItem(authStorageKey);
      })
      .finally(() => setIsCheckingStoredAuth(false));
  }, []);

  if (isCheckingStoredAuth) return <AuthLoading />;
  if (!trialAuth) return <AuthGate onVerified={setTrialAuth} />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(<Root />);
