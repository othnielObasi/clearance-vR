// Clearance companion server: fresh robot lines and the end-of-shift debrief from Muse Spark
// (via Baseten), and the relay for two-player co-op. The game never depends on it: every
// call has a timeout and the game falls back to its written lines.
import { createServer } from 'node:http';
import { cleanDebrief, cleanLines, debriefPrompt, linesPrompt, parseJson, stripReasoning } from './lines.js';
import { attachRelay } from './relay.js';

const PORT = Number(process.env.PORT ?? 8787);
const BASETEN_URL = (process.env.BASETEN_URL ?? 'https://inference.baseten.co/v1').replace(/\/$/, '');
const MODEL = process.env.BASETEN_MODEL ?? 'meta-models/muse-spark-open-1026';
const KEY = process.env.BASETEN_API_KEY ?? '';
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://clearance-v-r.vercel.app,https://othnielobasi.github.io')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const AI_TIMEOUT_MS = 15000;
const MAX_BODY = 8 * 1024;

// ---------------------------------------------------------------- small helpers

function allowedOrigin(origin) {
  if (!origin) return null;
  if (ORIGINS.includes(origin)) return origin;
  // Local development and the Quest on the LAN (Vite serves HTTPS on 5173).
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.destroy();
        resolve(null);
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// Per-visitor limit: a shift makes two calls, so 20 a minute is generous.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 20;
}

// Identical requests within 10 minutes share one answer (and one model call).
const cache = new Map();
function cached(key, make) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.value;
  const value = make().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

async function chat(messages, maxTokens) {
  if (!KEY) throw new Error('no model key configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(`${BASETEN_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      // Muse Spark Open reasons before answering, so leave room for that as well as the reply.
      body: JSON.stringify({ model: MODEL, messages, max_completion_tokens: maxTokens, temperature: 0.9 }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`model returned ${r.status}`);
    const j = await r.json();
    return stripReasoning(j?.choices?.[0]?.message?.content ?? '');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- routes

async function lines(body) {
  const crew = (Array.isArray(body?.crew) ? body.crew : []).slice(0, 6);
  const names = crew.map((c) => c?.name).filter((n) => typeof n === 'string');
  if (!names.length) return { lines: {} };
  const key = `lines:${JSON.stringify({ level: body.level, crew })}`;
  return cached(key, async () => {
    const text = await chat(linesPrompt({ level: body.level, crew }), 4096);
    return { lines: cleanLines(parseJson(text), names) };
  });
}

async function debrief(body) {
  const text = await chat(debriefPrompt(body ?? {}), 2048);
  return { text: cleanDebrief(text) };
}

const server = createServer(async (req, res) => {
  const origin = allowedOrigin(req.headers.origin);
  const url = new URL(req.url ?? '/', 'http://x');
  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403, origin
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' }
      : {});
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, ai: !!KEY }, origin);
  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' }, origin);
  if (!origin) return send(res, 403, { error: 'origin not allowed' }, null);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'slow down' }, origin);
  const body = await readJson(req);
  if (!body) return send(res, 400, { error: 'bad request' }, origin);
  try {
    if (url.pathname === '/api/lines') return send(res, 200, await lines(body), origin);
    if (url.pathname === '/api/debrief') return send(res, 200, await debrief(body), origin);
    return send(res, 404, { error: 'not found' }, origin);
  } catch (e) {
    // Never leak details; the game just uses its written lines.
    console.error(url.pathname, e instanceof Error ? e.message : e);
    return send(res, 503, { error: 'unavailable' }, origin);
  }
});

attachRelay(server, allowedOrigin);
server.listen(PORT, () => console.log(`clearance server on :${PORT} (ai ${KEY ? 'on' : 'off'})`));
