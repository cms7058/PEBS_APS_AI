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
