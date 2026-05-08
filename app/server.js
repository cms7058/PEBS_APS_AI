import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? process.env.AGENT_PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST_DIR = process.env.DIST_DIR ?? path.join(__dirname, 'dist');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const ALLOW_CLIENT_MODEL_CONFIG = process.env.ALLOW_CLIENT_MODEL_CONFIG === 'true';

const readJson = (request) =>
  new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });

const sendJson = (response, status, payload) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(payload));
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const sendStatic = async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(DIST_DIR, safePath);
  const fallbackPath = path.join(DIST_DIR, 'index.html');

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const ext = path.extname(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    createReadStream(fallbackPath).pipe(response);
  }
};

const buildPrompt = ({ question, plan }) => [
  {
    role: 'system',
    content: [
      '你是面向 CNC 与汽车零部件行业的 APS 排产智能体。',
      '你只能基于用户提供的当前排产数据回答，不要编造不存在的订单、设备或工序。',
      '回答要简洁、可执行，优先说明订单、设备、工序、开始结束时间、耗时、延期和建议动作。',
      '如果数据不足，明确说明缺少什么数据。',
    ].join('\n'),
  },
  {
    role: 'user',
    content: `用户问题：${question}\n\n当前排产摘要 JSON：\n${JSON.stringify(plan, null, 2)}`,
  },
];

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, service: 'pebs-aps-ai', model: DEEPSEEK_MODEL });
    return;
  }

  if (request.method === 'GET' && request.url === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      model: DEEPSEEK_MODEL,
      hasApiKey: Boolean(DEEPSEEK_API_KEY),
      allowClientModelConfig: ALLOW_CLIENT_MODEL_CONFIG,
    });
    return;
  }

  if (request.method !== 'POST' || request.url !== '/api/agent') {
    if (request.method === 'GET') {
      await sendStatic(request, response);
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  try {
    const payload = await readJson(request);
    const config = ALLOW_CLIENT_MODEL_CONFIG ? (payload.config ?? {}) : {};
    const apiKey = config.apiKey || DEEPSEEK_API_KEY;
    const model = config.model || DEEPSEEK_MODEL;
    const baseUrl = (config.baseUrl || DEEPSEEK_BASE_URL).replace(/\/$/, '');

    if (!apiKey) {
      sendJson(response, 400, {
        error: 'API Key 未配置',
        fallback: true,
      });
      return;
    }

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: buildPrompt(payload),
        temperature: 0.2,
        stream: false,
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      sendJson(response, upstream.status, { error: data?.error?.message ?? 'DeepSeek API error', detail: data });
      return;
    }

    sendJson(response, 200, {
      model,
      content: data.choices?.[0]?.message?.content ?? 'DeepSeek 未返回有效内容。',
    });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PEBS APS AI server listening on http://${HOST}:${PORT}`);
  console.log(`DeepSeek model: ${DEEPSEEK_MODEL}`);
});
