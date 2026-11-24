export const apiBase = (window.EMUPI_API || '').replace(/\/$/, '');
const crossOrigin = Boolean(apiBase && new URL(apiBase).origin !== location.origin);
const sessionKey = 'emupi-request-account-session';
let listenerSession = crossOrigin ? safeGet(sessionKey) : null;
export const $ = id => document.getElementById(id);
export async function api(path, { method = 'GET', data, token } = {}) {
  if (window.EMUPI_DEMO?.request) return window.EMUPI_DEMO.request(path, { method, data, token });
  if (!apiBase && location.hostname === 'emupi2020.github.io') throw new Error('リクエスト受付の準備中です。配信でのお知らせをお待ちください。');
  const headers = {};
  if (data) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Request-Token'] = token;
  if (listenerSession) headers.Authorization = 'Bearer ' + listenerSession;
  let response;
  try { response = await fetch(`${apiBase}${path}`, { method, headers, body: data ? JSON.stringify(data) : undefined, credentials: crossOrigin ? 'omit' : 'same-origin' }); }
  catch { throw new Error('接続できませんでした。通信を確認してお試しください。'); }
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '処理できませんでした。'); error.status = response.status; error.code = result.code; throw error; }
  if (crossOrigin && method === 'POST') {
    if (path === '/api/passcode/login' || path === '/api/passcode/register') {
      listenerSession = result.sessionToken || null;
      safeSet(sessionKey, listenerSession || '');
    } else if (path === '/auth/line/logout') {
      listenerSession = null;
      safeSet(sessionKey, '');
    }
  }
  return result;
}
export function message(value, error = false) { $('message').hidden = !value; $('message').textContent = value; $('message').classList.toggle('error', error); }
export function safeGet(key) { try { return localStorage.getItem((window.EMUPI_DEMO?.storagePrefix || '') + key); } catch { return null; } }
export function safeSet(key, value) { try { localStorage.setItem((window.EMUPI_DEMO?.storagePrefix || '') + key, value); return true; } catch { return false; } }
export const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[\s・･._\-’']/g,'');
export const statusText = { pending: '抽選待ちです。', selected: '選ばれました！', done: '歌唱済みです。次の受付もお楽しみに。', skipped: '今回は見送りになりました。', deferred: '次回配信に持ち越します。', removed: 'この応募は取り下げられました。' };
