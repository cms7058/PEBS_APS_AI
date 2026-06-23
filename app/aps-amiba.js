// 阿米巴动态智能体接入（PEBS APS 作为「机/料/环」子工具）。
//
// 接入闭环：阿米巴「工具接入」页生成连接器令牌 → 跳到本系统 /register →
// 落地页 POST /api/amiba/connect 落库（JSON 文件，APS 无数据库）→ 回调阿米巴
// /api/connectors/hello 上报能力。
//
// 数据回填：把 APS 排产引擎 KPI 映射成阿米巴 OTD 节点 KPI 回填——
//   计划达成率(plan_attain) ← 准交率 onTimeRate
//   换线时间(smed)          ← 平均换线分钟 avgSetupMinutes
//   设备 OEE(oee)           ← 设备负荷率 utilization（OEE 近似）
// 默认快照来自 runSchedule 对内置样本订单/工艺/产能的真实计算（见 README）；
// APS 前端可在 /api/amiba/sync 时带上实时 plan.kpi 覆盖。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(process.env.AMIBA_DATA_DIR ?? path.join(__dirname, 'data'), 'amiba.json');

export const APS_VERSION = '0.1.0';
export const APS_CAPABILITIES = ['有限产能排产', '插单重排', 'OEE', '产能瓶颈', '排料利用率', '库存周转'];

// 由 APS 排产引擎对内置样本订单/工艺/产能跑 runSchedule 得出（onTimeRate / utilization / 平均换线）。
const BASELINE_KPI = { onTimeRate: 100, utilization: 80, avgSetupMinutes: 24 };

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function saveConfig(cfg) {
  await mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function statusDict(cfg) {
  if (!cfg || !cfg.active) return { connected: false };
  return {
    connected: true,
    enterprise_id: cfg.enterpriseId,
    source: cfg.source,
    amiba_endpoint: cfg.amibaEndpoint,
    label: cfg.label ?? null,
    capabilities: cfg.capabilities ?? [],
    connected_at: cfg.connectedAt ?? null,
    last_hello_at: cfg.lastHelloAt ?? null,
    hello_ok: !!cfg.helloOk,
    hello_error: cfg.helloError ?? null,
    last_sync_at: cfg.lastSyncAt ?? null,
    last_sync_summary: cfg.lastSyncSummary ?? null,
  };
}

async function sayHello(cfg) {
  const url = cfg.amibaEndpoint.replace(/\/+$/, '') + '/api/connectors/hello';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.amibaToken}` },
      body: JSON.stringify({ version: APS_VERSION, capabilities: cfg.capabilities }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) return { ok: true, error: null };
    let detail = '';
    try { detail = (await resp.json()).error || ''; } catch { detail = ''; }
    return { ok: false, error: `hello 失败 HTTP ${resp.status}: ${detail}` };
  } catch (error) {
    return { ok: false, error: `无法连接阿米巴：${error.message}` };
  }
}

function kpiToUpdates(kpi) {
  const now = new Date().toISOString();
  const updates = [];
  if (typeof kpi.onTimeRate === 'number') updates.push({ nodeKey: 'planning', kpiKey: 'plan_attain', value: kpi.onTimeRate, capturedAt: now });
  if (typeof kpi.avgSetupMinutes === 'number') updates.push({ nodeKey: 'planning', kpiKey: 'smed', value: kpi.avgSetupMinutes, capturedAt: now });
  if (typeof kpi.utilization === 'number') updates.push({ nodeKey: 'production', kpiKey: 'oee', value: kpi.utilization, capturedAt: now });
  return updates;
}

async function syncToAmiba(cfg, kpiOverride) {
  const kpi = { ...BASELINE_KPI, ...(kpiOverride || {}) };
  const updates = kpiToUpdates(kpi);
  if (updates.length === 0) return { ok: false, error: '无可回填的排产 KPI' };

  const base = cfg.amibaEndpoint.replace(/\/+$/, '');
  try {
    const resp = await fetch(base + '/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.amibaToken}` },
      body: JSON.stringify({ source: 'aps', updates }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: body.error || `回填失败 HTTP ${resp.status}` };
    const summary = `准交率 ${kpi.onTimeRate}% · 设备负荷 ${kpi.utilization}% · 换线 ${kpi.avgSetupMinutes}min · KPI 回填 ${body.applied ?? updates.length} 项`;
    cfg.lastSyncAt = new Date().toISOString();
    cfg.lastSyncSummary = summary;
    await saveConfig(cfg);
    return { ok: true, applied: body.applied ?? updates.length, kpi, summary };
  } catch (error) {
    return { ok: false, error: `回填失败：${error.message}` };
  }
}

// ---- 路由处理（返回 {status, body}，由 server.js 负责 http 收发）----

export async function handleConnect(payload) {
  const { amiba_endpoint, amiba_token, enterprise_id, source, label } = payload || {};
  if (!amiba_endpoint || !amiba_token || !enterprise_id) {
    return { status: 400, body: { error: '缺少 amiba_endpoint / amiba_token / enterprise_id' } };
  }
  const cfg = {
    enterpriseId: enterprise_id,
    source: source || 'aps',
    amibaEndpoint: amiba_endpoint,
    amibaToken: amiba_token,
    label: label || null,
    capabilities: APS_CAPABILITIES,
    connectedAt: new Date().toISOString(),
    active: true,
  };
  const hello = await sayHello(cfg);
  cfg.helloOk = hello.ok;
  cfg.helloError = hello.error;
  cfg.lastHelloAt = new Date().toISOString();
  await saveConfig(cfg);

  let sync = null;
  if (hello.ok) sync = await syncToAmiba(cfg);
  return { status: 200, body: { ok: hello.ok, sync, ...statusDict(cfg) } };
}

export async function handleStatus() {
  return { status: 200, body: statusDict(await loadConfig()) };
}

// ---- 阿米巴「平台令牌登录 + 按产品建项目 + 产品级回填」（BOM 同款）----
//
// 用户从阿米巴「产品工作台」点「APS 排产」→ 带 平台令牌(apk_)+产品 跳到本系统
// /amiba/launch；本系统调阿米巴 /api/platform-auth/verify 核验平台令牌，按产品
// 建/绑一个排产项目，并用连接器令牌(amk_) 把该产品的排产 KPI 回填到阿米巴产品。

// 产品级排产快照（按内置样本计算的基准；前端可在 report 时覆盖）。
const PRODUCT_BASELINE = { onTimeRate: 100, utilization: 80, avgSetupMinutes: 24, planHours: 36 };

async function verifyPlatform(amibaEndpoint, username, token, tool) {
  const url = amibaEndpoint.replace(/\/+$/, '') + '/api/platform-auth/verify';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, token, tool }),
      signal: AbortSignal.timeout(10000),
    });
    return await resp.json();
  } catch (error) {
    return { valid: false, reason: `无法连接阿米巴平台：${error.message}` };
  }
}

export async function handleLaunch(payload) {
  const p = payload || {};
  const amibaEndpoint = p.amiba_endpoint;
  if (!amibaEndpoint || !p.platform_token || !p.username || !p.product_id) {
    return { status: 400, body: { error: '缺少 amiba_endpoint / platform_token / username / product_id' } };
  }
  const tool = p.tool || 'aps';
  const verify = await verifyPlatform(amibaEndpoint, p.username, p.platform_token, tool);
  if (!verify || !verify.valid) {
    return { status: 401, body: { error: verify?.reason || '平台令牌核验失败' } };
  }

  // 落库：连接器令牌(回填通道)随 launch 带来即可用，无需先走 /register
  let cfg = (await loadConfig()) || {};
  cfg.enterpriseId = p.enterprise_id || cfg.enterpriseId;
  cfg.enterpriseName = p.enterprise_name || cfg.enterpriseName || null;
  cfg.source = tool;
  cfg.amibaEndpoint = amibaEndpoint;
  if (p.connector_token) cfg.amibaToken = p.connector_token;
  cfg.capabilities = cfg.capabilities || APS_CAPABILITIES;
  cfg.active = true;
  cfg.connectedAt = cfg.connectedAt || new Date().toISOString();
  // 按产品建/绑排产项目
  cfg.bindings = cfg.bindings || {};
  cfg.bindings[p.product_id] = {
    productId: p.product_id,
    partNo: p.part_no || '',
    productName: p.product_name || '',
    enterpriseId: cfg.enterpriseId,
    boundAt: cfg.bindings[p.product_id]?.boundAt || new Date().toISOString(),
  };
  await saveConfig(cfg);

  // 按产品建/复用排产计时项目（多人任务来自阿米巴 team）
  let team = [];
  try { team = Array.isArray(p.team) ? p.team : JSON.parse(p.team || '[]'); } catch { team = []; }
  if (team.length === 0 && p.username) team = [{ username: p.username, displayName: verify.displayName || p.username }];
  const project = await ensureProject({
    enterpriseId: cfg.enterpriseId,
    enterpriseName: cfg.enterpriseName,
    productId: p.product_id,
    partNo: p.part_no || '',
    productName: p.product_name || '',
    amibaEndpoint,
    connectorToken: cfg.amibaToken,
    createdByUsername: p.username,
    team,
  });

  return {
    status: 200,
    body: {
      ok: true,
      // APS 前端用 localStorage 标记解锁试用门禁；平台令牌已在服务端核验
      auth: { email: verify.displayName || p.username, inviteCode: `amiba-${cfg.enterpriseId || 'ent'}`, verifiedAt: new Date().toISOString(), source: 'amiba' },
      projectId: project.id,
      productId: p.product_id,
      productName: p.product_name || '',
      partNo: p.part_no || '',
      enterpriseName: cfg.enterpriseName,
    },
  };
}

// 仅核验平台令牌并返回 APS 试用门禁解锁标记（供 /register 自动登录用，无产品）。
export async function handlePlatformLogin(payload) {
  const p = payload || {};
  if (!p.amiba_endpoint || !p.platform_token || !p.username) {
    return { status: 400, body: { error: '缺少 amiba_endpoint / platform_token / username' } };
  }
  const verify = await verifyPlatform(p.amiba_endpoint, p.username, p.platform_token, p.tool || 'aps');
  if (!verify || !verify.valid) return { status: 401, body: { error: verify?.reason || '平台令牌核验失败' } };
  return {
    status: 200,
    body: {
      ok: true,
      auth: { email: verify.displayName || p.username, inviteCode: `amiba-${p.enterprise_id || 'ent'}`, verifiedAt: new Date().toISOString(), source: 'amiba' },
      username: p.username,
      displayName: verify.displayName || p.username,
    },
  };
}

// ---------------- 排产计时项目（任务计时 + 提交回传工时，BOM 同款）----------------

const PROJECTS_FILE = path.join(process.env.AMIBA_DATA_DIR ?? path.join(__dirname, 'data'), 'amiba-projects.json');
const APS_LABOR_RATE = Number(process.env.APS_LABOR_RATE ?? 60); // ¥/h 默认工价
const APS_SCOPES = ['工艺与产能核对', '订单/插单排产', '设备分配与换线优化', '交期与瓶颈校验', '排产结果复核'];

async function loadProjects() {
  try { return JSON.parse(await readFile(PROJECTS_FILE, 'utf-8')); } catch { return []; }
}
async function saveProjects(list) {
  await mkdir(path.dirname(PROJECTS_FILE), { recursive: true });
  await writeFile(PROJECTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}
function nowSec() { return Math.floor(Date.now() / 1000); }
function taskElapsed(t) { return t.activeSeconds + (t.runningSince ? Math.max(0, nowSec() - t.runningSince) : 0); }
function projectDict(p) {
  const total = (p.tasks || []).reduce((s, t) => s + taskElapsed(t), 0);
  return {
    id: p.id, enterpriseId: p.enterpriseId, enterpriseName: p.enterpriseName,
    productId: p.productId, partNo: p.partNo, productName: p.productName,
    laborRate: p.laborRate, startedAt: p.startedAt, submittedAt: p.submittedAt || null, status: p.status,
    totalSeconds: total, manHours: Math.round((total / 3600) * 100) / 100,
    laborCost: Math.round((total / 3600) * p.laborRate * 100) / 100,
    tasks: (p.tasks || []).map((t) => ({
      id: t.id, assigneeUsername: t.assigneeUsername, assigneeDisplay: t.assigneeDisplay,
      scope: t.scope, status: t.status, running: !!t.runningSince, elapsedSeconds: taskElapsed(t),
    })),
    report: p.report || null,
  };
}

async function ensureProject(input) {
  const list = await loadProjects();
  const existing = list.find((p) => p.productId === input.productId && p.status === 'active');
  if (existing) return projectDict(existing);
  const team = input.team && input.team.length ? input.team : [{ username: input.createdByUsername || 'me' }];
  const solo = team.length === 1; // 单人（从接入直接进工具）：进入即自动开始计时
  const p = {
    id: 'aps_proj_' + Math.random().toString(36).slice(2, 10),
    enterpriseId: input.enterpriseId, enterpriseName: input.enterpriseName,
    productId: input.productId, partNo: input.partNo, productName: input.productName,
    amibaEndpoint: input.amibaEndpoint, connectorToken: input.connectorToken,
    createdByUsername: input.createdByUsername, laborRate: APS_LABOR_RATE,
    startedAt: new Date().toISOString(), submittedAt: null, status: 'active',
    tasks: team.map((m, i) => ({
      id: 'task_' + Math.random().toString(36).slice(2, 8),
      assigneeUsername: m.username, assigneeDisplay: m.displayName || m.username,
      scope: team.length > 1 ? APS_SCOPES[i % APS_SCOPES.length] : '整体排产作业',
      status: solo ? 'doing' : 'todo', activeSeconds: 0, runningSince: solo ? nowSec() : null,
    })),
  };
  list.push(p);
  await saveProjects(list);
  return projectDict(p);
}

export async function handleProjectGet(projectId) {
  const list = await loadProjects();
  const p = list.find((x) => x.id === projectId);
  if (!p) return { status: 404, body: { error: '项目不存在' } };
  return { status: 200, body: projectDict(p) };
}

export async function handleTaskAction(projectId, taskId, action) {
  const list = await loadProjects();
  const p = list.find((x) => x.id === projectId);
  if (!p) return { status: 404, body: { error: '项目不存在' } };
  const t = (p.tasks || []).find((x) => x.id === taskId);
  if (!t) return { status: 404, body: { error: '任务不存在' } };
  if (action === 'start') {
    if (!t.runningSince) { t.runningSince = nowSec(); t.status = 'doing'; }
  } else if (action === 'stop') {
    if (t.runningSince) { t.activeSeconds += Math.max(0, nowSec() - t.runningSince); t.runningSince = null; }
  } else if (action === 'done') {
    if (t.runningSince) { t.activeSeconds += Math.max(0, nowSec() - t.runningSince); t.runningSince = null; }
    t.status = 'done';
  } else {
    return { status: 400, body: { error: '未知操作' } };
  }
  await saveProjects(list);
  return { status: 200, body: projectDict(p) };
}

export async function handleSubmitProject(projectId) {
  const list = await loadProjects();
  const p = list.find((x) => x.id === projectId);
  if (!p) return { status: 404, body: { error: '项目不存在' } };
  if (p.status === 'submitted') return { status: 200, body: projectDict(p) };

  const members = [];
  let total = 0;
  for (const t of p.tasks || []) {
    if (t.runningSince) { t.activeSeconds += Math.max(0, nowSec() - t.runningSince); t.runningSince = null; }
    total += t.activeSeconds;
    members.push({ username: t.assigneeUsername, seconds: t.activeSeconds });
  }
  const manHours = Math.round((total / 3600) * 100) / 100;
  const laborCost = Math.round(manHours * p.laborRate * 100) / 100;

  let reportOk = false, reportErr = null;
  if (p.amibaEndpoint && p.connectorToken && p.productId) {
    const url = p.amibaEndpoint.replace(/\/+$/, '') + '/api/ingest/manhours';
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.connectorToken}` },
        body: JSON.stringify({
          productId: p.productId, manHours, laborCost, members,
          summary: `排产作业工时 ${manHours}h · 人工成本 ¥${Math.round(laborCost).toLocaleString('zh-CN')}`,
        }),
        signal: AbortSignal.timeout(12000),
      });
      reportOk = resp.ok;
      if (!resp.ok) reportErr = `HTTP ${resp.status}`;
    } catch (e) { reportErr = e.message; }
  } else {
    reportErr = '缺少连接器令牌/产品，未回传';
  }

  p.status = 'submitted';
  p.submittedAt = new Date().toISOString();
  p.report = { ok: reportOk, error: reportErr, manHours, laborCost };
  await saveProjects(list);
  return { status: 200, body: projectDict(p) };
}

export async function handleReport(payload) {
  const p = payload || {};
  const productId = p.productId || p.product_id;
  if (!productId) return { status: 400, body: { error: '缺少 productId' } };
  const cfg = await loadConfig();
  if (!cfg || !cfg.active || !cfg.amibaToken) return { status: 404, body: { error: '尚未接入阿米巴' } };
  const binding = cfg.bindings && cfg.bindings[productId];
  if (!binding) return { status: 404, body: { error: '该产品未在 APS 建立排产项目' } };

  // 该产品的排产 KPI 快照（前端可传 kpi 覆盖）
  const kpi = { ...PRODUCT_BASELINE, ...(p.kpi || {}) };
  const metrics = [
    { label: '准交率', value: kpi.onTimeRate, unit: '%' },
    { label: '设备负荷率', value: kpi.utilization, unit: '%' },
    { label: '平均换线', value: kpi.avgSetupMinutes, unit: 'min' },
  ];
  const summary = `准交率 ${kpi.onTimeRate}% · 设备负荷 ${kpi.utilization}% · 换线 ${kpi.avgSetupMinutes}min`;
  const body = { productId, manHours: kpi.planHours, summary, metrics };

  const base = cfg.amibaEndpoint.replace(/\/+$/, '');
  try {
    const resp = await fetch(base + '/api/ingest/manhours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.amibaToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const respBody = await resp.json().catch(() => ({}));
    if (!resp.ok) return { status: 200, body: { ok: false, error: respBody.error || `回填失败 HTTP ${resp.status}` } };
    cfg.lastSyncAt = new Date().toISOString();
    cfg.lastSyncSummary = `产品 ${binding.productName || productId}：${summary}`;
    await saveConfig(cfg);
    return { status: 200, body: { ok: true, sent: body, summary } };
  } catch (error) {
    return { status: 200, body: { ok: false, error: `回填失败：${error.message}` } };
  }
}

export async function handleSync(payload) {
  const cfg = await loadConfig();
  if (!cfg || !cfg.active) return { status: 404, body: { error: '尚未接入阿米巴' } };
  // 前端可传 { kpi: { onTimeRate, utilization, avgSetupMinutes } } 覆盖默认快照
  const result = await syncToAmiba(cfg, payload && payload.kpi);
  return { status: 200, body: result };
}

export const APS_REGISTER_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PEBS APS · 接入阿米巴</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:linear-gradient(160deg,#12091f,#1e1233);color:#ddd6fe;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .card{width:100%;max-width:520px;background:#100a1c;border:1px solid #2e1f4a;border-radius:16px;padding:28px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:#c4b5fd}
  .cube{width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#a78bfa,#7c3aed)}
  h1{margin:18px 0 6px;font-size:20px;color:#ede9fe}p{margin:0;font-size:13px;line-height:1.6;color:#b6a6da}
  .row{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:7px 0;border-bottom:1px solid #1e1433}
  .k{color:#9a86c0}.v{color:#ddd6fe;font-family:ui-monospace,monospace;word-break:break-all;text-align:right}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .chip{font-size:11px;padding:3px 9px;border-radius:999px;background:#1e1433;color:#c4b5fd;border:1px solid #3a2a5e}
  .ok{margin-top:16px;padding:12px 14px;border-radius:10px;background:#0c2a1d;border:1px solid #14532d;color:#6ee7b7;font-size:13px}
  .err{margin-top:16px;padding:12px 14px;border-radius:10px;background:#2a0c0c;border:1px solid #531414;color:#fca5a5;font-size:13px}
  .sync{margin-top:14px;padding:12px 14px;border-radius:10px;background:#100a1c;border:1px solid #2e1f4a}
  .btnrow{display:flex;gap:10px;margin-top:20px}
  a.btn{flex:1;text-align:center;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;display:inline-block}
  .primary{background:#7c3aed;color:#ede9fe}.ghost{background:transparent;color:#b6a6da;border:1px solid #2e1f4a}
</style></head><body><div class="card">
  <div class="brand"><span class="cube"></span><span>PEBS APS</span>
    <span style="color:#6b5a8f;font-weight:400">·</span><span style="color:#9a86c0;font-weight:400;font-size:13px">接入阿米巴动态智能体</span></div>
  <div id="content"><h1>正在接入…</h1><p>正在向阿米巴登记 APS 排产能力，请稍候。</p></div>
  <div class="btnrow"><a class="btn ghost" href="/">进入 APS</a><a id="back" class="btn primary" style="display:none">返回阿米巴</a></div>
</div>
<script>
(async function(){
  var q=new URLSearchParams(location.search);
  var p={amiba_endpoint:q.get('amiba_endpoint')||'',amiba_token:q.get('amiba_token')||'',enterprise_id:q.get('enterprise_id')||'',source:q.get('source')||'aps'};
  var content=document.getElementById('content'),back=document.getElementById('back');
  if(p.amiba_endpoint){back.style.display='inline-block';back.href=p.amiba_endpoint;}
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  // 链接带平台令牌+用户名（重新接入/换令牌入口）：做平台登录解锁；若同时带了产品，
  // 则按产品建计时项目（进入即开始计时），并把项目上下文存好，供 APS 操作页内嵌横幅使用。
  var pt=q.get('platform_token')||'',uname=q.get('username')||'';
  var prodId=q.get('product_id')||'';
  if(pt&&uname&&p.amiba_endpoint){
    try{
      if(prodId){
        var launchBody={amiba_endpoint:p.amiba_endpoint,platform_token:pt,username:uname,tool:p.source,
          enterprise_id:p.enterprise_id,enterprise_name:q.get('enterprise_name')||'',product_id:prodId,
          part_no:q.get('part_no')||'',product_name:q.get('product_name')||'',connector_token:p.amiba_token,team:'[]'};
        var lr=await fetch('/api/amiba/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(launchBody)});
        var ld=await lr.json();
        if(lr.ok&&ld.auth){
          localStorage.setItem('pebs-aps-ai-trial-auth',JSON.stringify(ld.auth));
          localStorage.setItem('pebs-aps-ai-last-activity',String(Date.now()));
          localStorage.setItem('pebs-aps-amiba-project',JSON.stringify({projectId:ld.projectId,productId:ld.productId,productName:ld.productName,partNo:ld.partNo,enterpriseName:ld.enterpriseName}));
        }
      }else{
        var lr2=await fetch('/api/amiba/platform-login',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({amiba_endpoint:p.amiba_endpoint,platform_token:pt,username:uname,tool:p.source,enterprise_id:p.enterprise_id})});
        var ld2=await lr2.json();
        if(lr2.ok&&ld2.auth){localStorage.setItem('pebs-aps-ai-trial-auth',JSON.stringify(ld2.auth));localStorage.setItem('pebs-aps-ai-last-activity',String(Date.now()));}
      }
    }catch(_){}
  }
  if(!p.amiba_endpoint||!p.amiba_token||!p.enterprise_id){content.innerHTML='<h1>缺少接入参数</h1><p>此页应由阿米巴「工具接入」点击「接入并跳转」自动打开。</p>';return;}
  try{
    var r=await fetch('/api/amiba/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    var d=await r.json();if(!r.ok)throw new Error(d.error||'接入失败');
    var caps=(d.capabilities||[]).map(function(c){return '<span class="chip">'+esc(c)+'</span>';}).join('');
    var sync=d.sync&&d.sync.ok?'<div class="sync"><div style="font-size:12px;color:#9a86c0;margin-bottom:6px">排产 KPI 回填阿米巴</div><div style="font-size:12.5px;color:#c4b5fd">'+esc(d.sync.summary||'')+'</div></div>':'';
    content.innerHTML='<h1>'+(d.hello_ok?'接入成功 ✓':'接入未完成')+'</h1>'+
      '<p>'+(d.hello_ok?'APS 已登记到阿米巴，排产 KPI（准交率/设备负荷/换线）已回填到主计划与生产节点。':'接入信息已保存，但回连阿米巴校验未通过。')+'</p>'+
      '<div style="margin-top:16px"><div class="row"><span class="k">服务企业 ID</span><span class="v">'+esc(d.enterprise_id)+'</span></div>'+
      '<div class="row"><span class="k">阿米巴地址</span><span class="v">'+esc(d.amiba_endpoint)+'</span></div>'+
      '<div class="row"><span class="k">能力上报</span><span class="v">'+(d.hello_ok?'已确认':'待确认')+'</span></div>'+
      '<div class="chips">'+caps+'</div></div>'+sync+
      (d.hello_ok?'<div class="ok">能力已上报阿米巴，接入闭环完成。</div>':'<div class="err">'+esc(d.hello_error||'')+'</div>');
  }catch(e){content.innerHTML='<h1>接入未完成</h1><div class="err">'+esc(e.message)+'</div>';}
})();
</script></body></html>`;

// 阿米巴「产品工作台 → 打开工作台(APS)」跳来：核验平台令牌 → 解锁 APS → 进入排产。
export const APS_LAUNCH_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PEBS APS · 登入排产</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:linear-gradient(160deg,#12091f,#1e1233);color:#ddd6fe;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .card{width:100%;max-width:460px;background:#100a1c;border:1px solid #2e1f4a;border-radius:16px;padding:28px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:#c4b5fd}
  .cube{width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#a78bfa,#7c3aed)}
  h1{margin:18px 0 6px;font-size:20px;color:#ede9fe}p{margin:0;font-size:13px;line-height:1.6;color:#b6a6da}
  .err{margin-top:16px;padding:12px 14px;border-radius:10px;background:#2a0c0c;border:1px solid #531414;color:#fca5a5;font-size:13px}
  a.btn{display:inline-block;margin-top:16px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;background:#7c3aed;color:#ede9fe}
</style></head><body><div class="card">
  <div class="brand"><span class="cube"></span><span>PEBS APS</span>
    <span style="color:#6b5a8f;font-weight:400">·</span><span style="color:#9a86c0;font-weight:400;font-size:13px">用阿米巴平台令牌登入排产</span></div>
  <div id="content"><h1>正在登录…</h1><p>正在用阿米巴平台令牌核验并按产品建排产项目，请稍候。</p></div>
</div>
<script>
(async function(){
  var q=new URLSearchParams(location.search);
  var p={amiba_endpoint:q.get('amiba_endpoint')||'',platform_token:q.get('platform_token')||'',
    username:q.get('username')||'',tool:q.get('tool')||'aps',enterprise_id:q.get('enterprise_id')||'',
    enterprise_name:q.get('enterprise_name')||'',product_id:q.get('product_id')||'',part_no:q.get('part_no')||'',
    product_name:q.get('product_name')||'',connector_token:q.get('connector_token')||'',team:q.get('team')||'[]'};
  var content=document.getElementById('content');
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  if(!p.platform_token||!p.username||!p.product_id){content.innerHTML='<h1>缺少登录参数</h1><p>此页应由阿米巴「产品工作台」打开。</p>';return;}
  try{
    var r=await fetch('/api/amiba/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    var d=await r.json();if(!r.ok)throw new Error(d.error||'登录失败');
    // 写入 APS 试用门禁标记解锁前端（平台令牌已服务端核验），使 APS 主应用也直接可用
    localStorage.setItem('pebs-aps-ai-trial-auth',JSON.stringify(d.auth||{email:p.username,inviteCode:'amiba'}));
    localStorage.setItem('pebs-aps-ai-last-activity',String(Date.now()));
    localStorage.setItem('pebs-aps-amiba-product',JSON.stringify({productId:d.productId,productName:d.productName,partNo:d.partNo}));
    // 直接进入按产品的排产计时工作台（开始/暂停/完成 + 提交并回传工时）
    location.replace('/amiba/project?id='+encodeURIComponent(d.projectId));
  }catch(e){content.innerHTML='<h1>登录失败</h1><div class="err">'+esc(e.message)+'</div><a class="btn" href="/">返回</a>';}
})();
</script></body></html>`;

// 阿米巴排产计时工作台（按产品）：多人任务计时 + 提交并回传工时到阿米巴。
export const APS_WORKBENCH_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PEBS APS · 排产工作台</title>
<style>
  body{margin:0;min-height:100vh;padding:24px;background:#0b1220;color:#e2e8f0;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:24px;border:1px solid #1e293b;border-radius:16px;background:#0f172a}
  .brand{font-weight:700;color:#a78bfa;margin-bottom:12px}
  .head{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
  .pname{font-size:18px;font-weight:700;color:#f8fafc}.pno{font-family:monospace;font-size:12px;color:#64748b;margin-left:6px}
  .ent{font-size:12px;color:#94a3b8}
  .timer{margin-left:auto;text-align:right}
  .big{font-size:26px;font-weight:700;font-family:monospace;color:#a78bfa}
  .sub{font-size:11px;color:#94a3b8}
  .task{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid #1e293b;background:#0f172a;margin-top:8px}
  .task.run{background:#1a1033}
  .who{width:120px;font-size:13px;font-weight:600}.scope{flex:1;min-width:140px;font-size:12px;color:#94a3b8}
  .te{font-family:monospace;font-size:15px}.badge{font-size:11px;padding:2px 8px;border-radius:999px;background:#1e293b}
  button{border:none;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;color:#fff}
  .start{background:#10b981}.stop{background:#f59e0b}.done{background:#334155}.submit{background:#7c3aed;margin-top:18px;padding:10px 20px;font-size:14px}
  .err{color:#fca5a5}.ok{margin-top:18px;padding:12px 14px;border-radius:10px;background:#0c2a1d;border:1px solid #14532d;color:#6ee7b7;font-size:13px}
  .warn{margin-top:18px;padding:12px 14px;border-radius:10px;background:#2a1d0c;border:1px solid #533a14;color:#fcd34d;font-size:13px}
  button:disabled{opacity:.5;cursor:not-allowed}
</style></head><body><div class="wrap">
  <div class="brand">PEBS APS · 阿米巴排产工作台</div>
  <div id="content">加载中…</div>
</div>
<script>
(function(){
  var id=new URLSearchParams(location.search).get('id')||'';
  var proj=null, fetchedAt=Date.now();
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  function hms(sec){sec=Math.max(0,Math.floor(sec));var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    function z(n){return(n<10?'0':'')+n;}return z(h)+':'+z(m)+':'+z(s);}
  function liveOf(t){return t.elapsedSeconds+((t.running&&proj.status!=='submitted')?(Date.now()-fetchedAt)/1000:0);}
  async function load(){var r=await fetch('/api/amiba/projects/'+encodeURIComponent(id));var d=await r.json();
    if(!r.ok){document.getElementById('content').innerHTML='<p class="err">'+esc(d.error||'加载失败')+'</p>';return;}
    proj=d;fetchedAt=Date.now();render();}
  async function act(tid,a){var r=await fetch('/api/amiba/projects/'+encodeURIComponent(id)+'/tasks/'+encodeURIComponent(tid)+'/'+a,{method:'POST'});
    var d=await r.json();if(r.ok){proj=d;fetchedAt=Date.now();render();}}
  async function submit(){if(!confirm('提交本排产项目？将停止计时、汇总工时并回传到阿米巴。'))return;
    var r=await fetch('/api/amiba/projects/'+encodeURIComponent(id)+'/submit',{method:'POST'});var d=await r.json();
    if(!r.ok){alert(d.error||'提交失败');return;}proj=d;fetchedAt=Date.now();render();}
  window.__apsAct=act;window.__apsSubmit=submit;
  function render(){
    if(!proj)return;var submitted=proj.status==='submitted';
    var total=proj.tasks.reduce(function(s,t){return s+liveOf(t);},0);
    var rows=proj.tasks.map(function(t){
      var ctrl=submitted?'':'<span style="display:flex;gap:6px">'+
        (!t.running?'<button class="start" '+(t.status==='done'?'disabled':'')+' onclick="__apsAct(\\''+t.id+'\\',\\'start\\')">开始</button>'
                   :'<button class="stop" onclick="__apsAct(\\''+t.id+'\\',\\'stop\\')">暂停</button>')+
        '<button class="done" '+(t.status==='done'?'disabled':'')+' onclick="__apsAct(\\''+t.id+'\\',\\'done\\')">完成</button></span>';
      var st=t.status==='done'?'已完成':(t.running?'进行中':'待开始');
      return '<div class="task'+(t.running&&!submitted?' run':'')+'"><span class="who">'+esc(t.assigneeDisplay)+'</span>'+
        '<span class="scope">'+esc(t.scope)+'</span><span class="te" style="color:'+(t.running?'#a78bfa':'#cbd5e1')+'">'+hms(liveOf(t))+'</span>'+
        '<span class="badge" style="color:'+(t.status==='done'?'#6ee7b7':(t.running?'#fcd34d':'#94a3b8'))+'">'+st+'</span>'+ctrl+'</div>';
    }).join('');
    var foot=submitted
      ? '<div class="'+(proj.report&&proj.report.ok?'ok':'warn')+'">'+(proj.report&&proj.report.ok
          ? '已提交并回传阿米巴：总工时 '+proj.manHours+'h · 人工成本 ¥'+Math.round(proj.laborCost).toLocaleString('zh-CN')+'。已落到该产品的排产节点。'
          : '已提交（总工时 '+proj.manHours+'h），但回传阿米巴未成功：'+esc((proj.report&&proj.report.error)||'未知')+'。')+'</div>'
      : '<button class="submit" onclick="__apsSubmit()">提交并回传工时到阿米巴</button>';
    document.getElementById('content').innerHTML=
      '<div class="head"><div><div class="pname">'+esc(proj.productName||proj.partNo||'产品')+'<span class="pno">'+esc(proj.partNo||'')+'</span></div>'+
      '<div class="ent">'+esc(proj.enterpriseName||'')+' · 排产作业计时'+(submitted?' · 已提交':'')+'</div></div>'+
      '<div class="timer"><div class="big">'+hms(total)+'</div><div class="sub">总人工工时 '+(total/3600).toFixed(2)+'h · 估算成本 ¥'+Math.round(total/3600*proj.laborRate).toLocaleString('zh-CN')+'</div></div></div>'+
      rows+foot;
  }
  if(!id){document.getElementById('content').innerHTML='<p class="err">缺少项目 id</p>';}else{load();setInterval(render,1000);}
})();
</script></body></html>`;
