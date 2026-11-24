import { initialState, publicState, ownRequests, requestsByName, receipt, listenerReceipt, accountRequests, submit, rename, canRename, editSong, adminAction, songStatus, nameKey, text, Problem, prune, rolloverSession } from './domain.mjs';
import { hash, isAdmin, auth } from './auth.mjs';
import { isOfficialSiteRequest, lineAuth, lineEnabled, listenerId, listenerSession } from './line-login.mjs';
import { passcodeAuth, passcodeAccountId, passcodeRequiredMessage } from './passcode.mjs';
import { catalog } from '../request/catalog.mjs';
import { categoryOf } from '../request/categories.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const stateConflict = () => new Problem('アクセスが重なりました。少し待ってもう一度お試しください。', 409);
function saveState(env, revision, state) {
  return env.DB.prepare('UPDATE app_state SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ? RETURNING revision')
    .bind(JSON.stringify(state), revision).first();
}
export async function read(env, now = Date.now()) {
  await env.DB.prepare('INSERT OR IGNORE INTO app_state (id, revision, body) VALUES (1, 0, ?)').bind(JSON.stringify(initialState(now))).run();
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = await env.DB.prepare('SELECT revision, body FROM app_state WHERE id = 1').first();
    const state = { ...JSON.parse(row.body), open: true };
    if (!rolloverSession(state, now)) return { revision:row.revision, state };
    const saved = await saveState(env, row.revision, state);
    if (saved) return { revision:saved.revision, state };
  }
  throw stateConflict();
}
export async function mutate(env, action) {
  for (let n = 0; n < 12; n++) {
    const { revision, state } = await read(env);
    prune(state);
    const value = await action(state);
    const result = await saveState(env, revision, state);
    if (result) return { value, state };
  }
  throw stateConflict();
}
function requestsToRecover(state, accountId, name) {
  const slot = entry => `${entry.round}:${categoryOf(entry)}`;
  const occupied = new Set(state.entries.filter(entry => entry.accountId === accountId).map(slot));
  const key = nameKey(name);
  return state.entries.filter(entry => {
    if (entry.encoreOf || entry.accountId || nameKey(entry.name) !== key || occupied.has(slot(entry))) return false;
    occupied.add(slot(entry));
    return true;
  });
}
async function recoverPasscodeRequests(env, { accountId, name }) {
  const { state } = await read(env);
  prune(state);
  if (!requestsToRecover(state, accountId, name).length) return 0;
  const { value } = await mutate(env, latest => {
    const entries = requestsToRecover(latest, accountId, name);
    for (const entry of entries) entry.accountId = accountId;
    return entries.length;
  });
  return value;
}
async function canManageRequest(env, entry, accountId) {
  const protectedAccount = entry.accountId || await passcodeAccountId(env, entry.name);
  return !protectedAccount || protectedAccount === accountId;
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
  if (path === '/api/bug-reports' && req.method === 'POST') {
    await limit(req, env, ':bug-report');
    const input = await body(req);
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    if (!message || [...message].length > 1000) throw new Problem('報告内容は1〜1,000文字で入力してください。');
    const name = text(input?.name, 'Pocochaの名前', 50);
    await env.DB.prepare('INSERT INTO bug_reports (name, message, created_at) VALUES (?, ?, ?)').bind(name, message, Date.now()).run();
    return json({ ok: true }, 201);
  }
  if (path === '/api/passcode/entry' && req.method === 'POST') {
    await limit(req, env, ':passcode-entry');
    return json({ requiresPasscode: Boolean(await passcodeAccountId(env, (await body(req))?.name)) });
  }
  if (['/api/passcode/register', '/api/passcode/login'].includes(path) && req.method === 'POST') {
    await limit(req, env, ':passcode');
    const input = await body(req);
    if (path === '/api/passcode/register') {
      if (await passcodeAccountId(env, input?.name)) throw new Problem(passcodeRequiredMessage, 409, 'passcode_required');
      const hashes = new Set(await requestTokenHashes(input?.tokens ?? []));
      const { state } = await read(env);
      prune(state);
      const previous = state.entries.filter(entry => nameKey(entry.name) === nameKey(input.name) && entry.status !== 'removed');
      if (previous.length && !previous.some(entry => !entry.accountId && hashes.has(entry.tokenHash))) {
        throw new Problem('この名前でリクエストを送ったブラウザーからパスコードを設定してください。', 409);
      }
    }
    const authenticated = await passcodeAuth(env, path.split('/').at(-1), input, isOfficialSiteRequest(req, env));
    await recoverPasscodeRequests(env, authenticated);
    return authenticated.response;
  }
  if (path === '/api/state' && req.method === 'GET') return json(publicState((await read(env)).state));
  if (path === '/api/song-status' && req.method === 'GET') return json(songStatus((await read(env)).state, url.searchParams.get('artist'), url.searchParams.get('song')));
  if (path === '/api/suggestions' && req.method === 'GET') {
    const { state } = await read(env);
    return json({ items: [...catalog, ...state.suggestions.map(s => ({ artist: s.artist, song: s.song }))] });
  }
  if (path === '/api/mine' && req.method === 'GET') {
    const entry = receipt((await read(env)).state, await requestToken(req));
    if (entry?.editable && await passcodeAccountId(env, entry.name)) {
      entry.editable = false;
      entry.songEditable = false;
    }
    return json({ entry });
  }
  if (path === '/api/listener-account' && ['GET', 'POST'].includes(req.method)) {
    const session = await listenerSession(req, env);
    const accountId = session?.accountId;
    const enabled = lineEnabled(env);
    const passcodeEnabled = Boolean(env.SESSION_SECRET?.length >= 32);
    if (req.method === 'GET') {
      if (!accountId) return json({ enabled, passcodeEnabled, signedIn: false, name: '', entries: [], receipts: [] });
      const { state } = await read(env);
      prune(state);
      const account = accountRequests(state, accountId);
      const method = session.kind === 'pin-listener' ? 'passcode' : 'line';
      const needsRecovery = method === 'passcode' && requestsToRecover(state, accountId, session.name).length > 0;
      return json({ ...account, name: account.name || session.name || '', enabled, passcodeEnabled, signedIn: true, method, needsRecovery });
    }
    if (!accountId) throw new Problem('ログインしてください。', 401);
    await limit(req, env);
    if (session.kind === 'pin-listener') return json({ linked: await recoverPasscodeRequests(env, session) });
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
    const protectedAccount = await passcodeAccountId(env, input?.name);
    if (protectedAccount && protectedAccount !== accountId) throw new Problem(passcodeRequiredMessage, 401, 'passcode_required');
    const result = await mutate(env, state => submit(state, input, token, Date.now(), accountId));
    return json({ entry: listenerReceipt(result.state, result.value, true) }, 201);
  }
  if (path === '/api/mine' && req.method === 'PATCH') {
    await limit(req, env);
    const input = await body(req);
    const accountId = await listenerId(req, env);
    if (input?.action === 'renameAll') {
      const hashes = new Set(await requestTokenHashes(input.tokens));
      const {value: updated} = await mutate(env, async state => {
        const candidates = state.entries.filter(entry => canRename(state, entry) &&
          (entry.accountId ? input.account === true && entry.accountId === accountId : hashes.has(entry.tokenHash)));
        const allowed = await Promise.all(candidates.map(entry => canManageRequest(env, entry, accountId)));
        const entries = candidates.filter((_, i) => allowed[i]);
        if (!entries.length) throw new Problem('名前を修正できるリクエストがありません。', 409);
        for (const entry of entries) rename(state, entry, input.name);
        return entries.length;
      });
      return json({updated});
    }
    const viaAccount = input?.action === 'editSong' && typeof input.requestId === 'string';
    if (viaAccount && !accountId) throw new Problem('ログインしてください。', 401);
    const token = viaAccount ? null : await requestToken(req);
    const result = await mutate(env, async state => {
      const e = viaAccount
        ? state.entries.find(entry => entry.accountId === accountId && entry.id === input.requestId)
        : state.entries.findLast(entry => entry.tokenHash === token);
      if (!e) throw new Problem('応募が見つかりません。', 404);
      if (!await canManageRequest(env, e, accountId)) throw new Problem('連携したアカウントでログインしてください。', 401);
      if (input?.action === 'editSong') editSong(state, e, input);
      else rename(state, e, input?.name);
      return e;
    });
    return json({ entry: listenerReceipt(result.state, result.value, true) });
  }
  if (path.startsWith('/api/admin')) {
    if (req.method !== 'GET' && req.headers.get('Origin') !== url.origin) throw new Problem('管理画面から操作してください。', 403);
    if (!await isAdmin(req, env)) throw new Problem('管理者ログインが必要です。', 401);
    if (path === '/api/admin/bug-reports' && req.method === 'GET') {
      const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(before) || before < 1) throw new Problem('取得位置を確認してください。');
      const { results } = await env.DB.prepare('SELECT id, name, message, created_at AS createdAt FROM bug_reports WHERE id < ? ORDER BY id DESC LIMIT 21').bind(before).all();
      const reports = results.slice(0, 20);
      return json({ reports, next: results.length > 20 ? reports.at(-1).id : null });
    }
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
    catch (error) { response = json({ error: error instanceof Problem ? error.message : '処理できませんでした。時間をおいてお試しください。', code: error instanceof Problem ? error.code : undefined, details: error instanceof Problem ? error.details : undefined }, error.status || 500); }
    const headers = new Headers(response.headers), origin = req.headers.get('Origin');
    if (origins(env, req).has(origin)) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Request-Token, Authorization'); headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS'); }
    headers.set('Vary', 'Origin'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'strict-origin-when-cross-origin'); headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.workers.dev; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(event, env) {
    if (event.cron === '0,1 6 * * *') {
      await read(env, event.scheduledTime ?? Date.now());
      return;
    }
    await mutate(env, state => prune(state));
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()).run();
  }
};
