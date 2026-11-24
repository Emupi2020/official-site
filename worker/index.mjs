import { initialState, publicState, ownRequests, requestsByName, receipt, listenerReceipt, accountRequests, submit, rename, canRename, editSong, adminAction, songStatus, Problem, prune } from './domain.mjs';
import { hash, isAdmin, auth } from './auth.mjs';
import { lineAuth, lineEnabled, listenerId } from './line-login.mjs';
import { catalog } from '../request/catalog.mjs';
import { categoryOf } from '../request/categories.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export async function read(env) {
  await env.DB.prepare('INSERT OR IGNORE INTO app_state (id, revision, body) VALUES (1, 0, ?)').bind(JSON.stringify(initialState())).run();
  const row = await env.DB.prepare('SELECT revision, body FROM app_state WHERE id = 1').first();
  return { revision: row.revision, state: { ...JSON.parse(row.body), open: true } };
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
async function limit(req, env, scope = '') {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const minute = Math.floor(Date.now() / 60000), key = await hash(`${env.SESSION_SECRET || 'local'}:${ip}:${minute}${scope}`);
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
  if (['/demo','/demo/','/demo.html'].includes(path) && req.method === 'GET') return new Response(null,{status:302,headers:{Location:url.searchParams.get('view')==='request'?'/':'/admin/','Cache-Control':'no-store'}});
  if (path.startsWith('/auth/line/')) return lineAuth(req, env);
  if (path.startsWith('/auth/')) return auth(req, env);
  if (path === '/config.js') return new Response('window.EMUPI_API = location.origin;', { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!path.startsWith('/api/')) {
    if (path === '/admin' || path === '/admin/') return env.ASSETS.fetch(new Request(new URL('/admin', req.url), req));
    return env.ASSETS.fetch(req);
  }
  if (!env.DB) throw new Problem('応募受付の準備中です。', 503);
  if (path === '/api/state' && req.method === 'GET') return json(publicState((await read(env)).state));
  if (path === '/api/song-status' && req.method === 'GET') return json(songStatus((await read(env)).state, url.searchParams.get('artist'), url.searchParams.get('song')));
  if (path === '/api/suggestions' && req.method === 'GET') {
    const { state } = await read(env);
    return json({ items: [...catalog, ...state.suggestions.map(s => ({ artist: s.artist, song: s.song }))] });
  }
  if (path === '/api/mine' && req.method === 'GET') return json({ entry: receipt((await read(env)).state, await requestToken(req)) });
  if (path === '/api/listener-account' && ['GET', 'POST'].includes(req.method)) {
    const accountId = await listenerId(req, env);
    const empty = { enabled: lineEnabled(env), signedIn: false, name: '', entries: [], receipts: [] };
    if (req.method === 'GET') {
      if (!accountId) return json(empty);
      const { state } = await read(env);
      prune(state);
      return json({ ...accountRequests(state, accountId), enabled: true, signedIn: true });
    }
    if (!accountId) throw new Problem('LINEでログインしてください。', 401);
    await limit(req, env);
    const hashes = new Set(await requestTokenHashes((await body(req))?.tokens));
    const { value: linked } = await mutate(env, state => {
      const entries = state.entries.filter(entry => !entry.accountId && hashes.has(entry.tokenHash));
      for (const entry of entries) {
        if (state.entries.some(other => other.accountId === accountId && other.round === entry.round && categoryOf(other) === categoryOf(entry))) continue;
        entry.accountId = accountId;
      }
      return entries.filter(entry => entry.accountId === accountId).length;
    });
    return json({ linked });
  }
  if (path === '/api/my-requests' && req.method === 'POST') {
    const input = await body(req);
    const hashes = await requestTokenHashes(input?.tokens);
    return json({ entries: ownRequests((await read(env)).state, hashes) });
  }
  if (path === '/api/requests-by-name' && req.method === 'POST') {
    await limit(req, env, ':name-lookup');
    const input = await body(req);
    const { state } = await read(env);
    prune(state);
    return json({ entries: requestsByName(state, input?.name) });
  }
  if (path === '/api/requests' && req.method === 'POST') {
    await limit(req, env);
    const token = await requestToken(req), input = await body(req);
    const accountId = await listenerId(req, env);
    const result = await mutate(env, state => submit(state, input, token, Date.now(), accountId));
    return json({ entry: listenerReceipt(result.state, result.value, true) }, 201);
  }
  if (path === '/api/mine' && req.method === 'PATCH') {
    await limit(req, env);
    const input = await body(req);
    const accountId = await listenerId(req, env);
    if (input?.action === 'renameAll') {
      const hashes = new Set(await requestTokenHashes(input.tokens));
      const {value: updated} = await mutate(env, state => {
        const entries = state.entries.filter(entry => canRename(state, entry) &&
          (entry.accountId ? input.account === true && entry.accountId === accountId : hashes.has(entry.tokenHash)));
        if (!entries.length) throw new Problem('名前を修正できるリクエストがありません。', 409);
        for (const entry of entries) rename(state, entry, input.name);
        return entries.length;
      });
      return json({updated});
    }
    const viaAccount = input?.action === 'editSong' && typeof input.requestId === 'string';
    if (viaAccount && !accountId) throw new Problem('LINEでログインしてください。', 401);
    const token = viaAccount ? null : await requestToken(req);
    const result = await mutate(env, state => {
      const e = viaAccount
        ? state.entries.find(entry => entry.accountId === accountId && entry.id === input.requestId)
        : state.entries.findLast(entry => entry.tokenHash === token);
      if (!e) throw new Problem('応募が見つかりません。', 404);
      if (e.accountId && e.accountId !== accountId) throw new Problem('連携したLINEアカウントでログインしてください。', 401);
      if (input?.action === 'editSong') editSong(state, e, input);
      else rename(state, e, input?.name);
      return e;
    });
    return json({ entry: listenerReceipt(result.state, result.value, true) });
  }
  if (path.startsWith('/api/admin')) {
    if (req.method !== 'GET' && req.headers.get('Origin') !== url.origin) throw new Problem('管理画面から操作してください。', 403);
    if (!await isAdmin(req, env)) throw new Problem('管理者ログインが必要です。', 401);
    if (path === '/api/admin' && req.method === 'GET') {
      const { state } = await read(env);
      return json({ ...state, entries: state.entries.map(({ tokenHash, usedNames, accountId, ...entry }) => entry) });
    }
    if (path === '/api/admin' && req.method === 'POST') {
      const input = await body(req);
      await mutate(env, state => adminAction(state, input)); return json({ ok: true });
    }
  }
  throw new Problem('見つかりません。', 404);
}
async function requestTokenHashes(tokens) {
  if (!Array.isArray(tokens) || tokens.length > 100 || tokens.some(token => typeof token !== 'string' || !/^[a-zA-Z0-9_-]{32,100}$/.test(token))) {
    throw new Problem('保存されたリクエスト情報を確認できません。');
  }
  return Promise.all(tokens.map(hash));
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
    catch (error) { response = json({ error: error instanceof Problem ? error.message : '処理できませんでした。時間をおいてお試しください。', code: error instanceof Problem ? error.code : undefined }, error.status || 500); }
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
