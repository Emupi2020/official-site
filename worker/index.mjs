import { initialState, publicState, receipt, submit, rename, adminAction, Problem, prune } from './domain.mjs';
import { hash, isAdmin, auth } from './auth.mjs';
import { catalog } from '../request/catalog.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export async function read(env) {
  await env.DB.prepare('INSERT OR IGNORE INTO app_state (id, revision, body) VALUES (1, 0, ?)').bind(JSON.stringify(initialState())).run();
  const row = await env.DB.prepare('SELECT revision, body FROM app_state WHERE id = 1').first();
  return { revision: row.revision, state: JSON.parse(row.body) };
}
export async function mutate(env, action) {
  for (let n = 0; n < 12; n++) {
    const { revision, state } = await read(env);
    prune(state);
    const value = action(state);
    const result = await env.DB.prepare('UPDATE app_state SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ? RETURNING revision').bind(JSON.stringify(state), revision).first();
    if (result) return { value, state };
  }
  throw new Problem('アクセスが重なりました。少し待ってもう一度お試しください。', 409);
}
function origins(env, req) { return new Set([env.PUBLIC_ORIGIN || 'https://emupi2020.github.io', new URL(req.url).origin]); }
async function requestToken(req) {
  const value = req.headers.get('X-Request-Token');
  if (!value || !/^[a-zA-Z0-9_-]{32,100}$/.test(value)) throw new Problem('応募情報を確認できません。ページを開き直してください。');
  return hash(value);
}
async function limit(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const minute = Math.floor(Date.now() / 60000), key = await hash(`${env.SESSION_SECRET || 'local'}:${ip}:${minute}`);
  const value = await env.DB.prepare('INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key, Date.now() + 120000).first();
  if (value.count > 20) throw new Problem('送信が続いています。少し待ってお試しください。', 429);
}
async function handle(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!origins(env, req).has(req.headers.get('Origin'))) throw new Problem('このページからは操作できません。', 403);
    if (path.startsWith('/api/') && !(req.headers.get('Content-Type') || '').startsWith('application/json')) throw new Problem('送信形式を確認してください。', 415);
    if (Number(req.headers.get('Content-Length')) > 12000) throw new Problem('入力が長すぎます。', 413);
  }
  if (path.startsWith('/auth/')) return auth(req, env);
  if (path === '/config.js') return new Response('window.EMUPI_API = location.origin;', { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!path.startsWith('/api/')) {
    if (path === '/admin' || path === '/admin/') return env.ASSETS.fetch(new Request(new URL('/admin', req.url), req));
    return env.ASSETS.fetch(req);
  }
  if (!env.DB) throw new Problem('応募受付の準備中です。', 503);
  if (path === '/api/state' && req.method === 'GET') return json(publicState((await read(env)).state));
  if (path === '/api/suggestions' && req.method === 'GET') {
    const { state } = await read(env);
    return json({ items: [...catalog, ...state.suggestions.map(s => ({ artist: s.artist, song: s.song }))] });
  }
  if (path === '/api/mine' && req.method === 'GET') return json({ entry: receipt((await read(env)).state, await requestToken(req)) });
  if (path === '/api/requests' && req.method === 'POST') {
    await limit(req, env);
    const token = await requestToken(req), input = await body(req);
    const result = await mutate(env, state => submit(state, input, token));
    return json({ entry: receipt(result.state, token) }, 201);
  }
  if (path === '/api/mine' && req.method === 'PATCH') {
    await limit(req, env);
    const token = await requestToken(req), input = await body(req);
    const result = await mutate(env, state => {
      const e = state.entries.findLast(e => e.tokenHash === token);
      if (!e) throw new Problem('応募が見つかりません。', 404);
      rename(state, e, input.name);
    });
    return json({ entry: receipt(result.state, token) });
  }
  if (path.startsWith('/api/admin')) {
    if (req.method !== 'GET' && req.headers.get('Origin') !== url.origin) throw new Problem('管理画面から操作してください。', 403);
    if (!await isAdmin(req, env)) throw new Problem('管理者ログインが必要です。', 401);
    if (path === '/api/admin' && req.method === 'GET') {
      const { state } = await read(env);
      return json({ ...state, entries: state.entries.map(({ tokenHash, usedNames, ...entry }) => entry) });
    }
    if (path === '/api/admin' && req.method === 'POST') {
      const input = await body(req);
      await mutate(env, state => adminAction(state, input)); return json({ ok: true });
    }
  }
  throw new Problem('見つかりません。', 404);
}
async function body(req) {
  const raw = await req.text();
  if (raw.length > 12000) throw new Problem('入力が長すぎます。', 413);
  try { return JSON.parse(raw); } catch { throw new Problem('入力を確認してください。'); }
}
export default {
  async fetch(req, env) {
    let response;
    try { response = await handle(req, env); }
    catch (error) { response = json({ error: error instanceof Problem ? error.message : '処理できませんでした。時間をおいてお試しください。' }, error.status || 500); }
    const headers = new Headers(response.headers), origin = req.headers.get('Origin');
    if (origins(env, req).has(origin)) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Request-Token'); headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS'); }
    headers.set('Vary', 'Origin'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'strict-origin-when-cross-origin'); headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.workers.dev; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event, env) {
    await mutate(env, state => prune(state));
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()).run();
  }
};
