import { Problem } from './domain.mjs';
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unb64 = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export async function hash(value) { return b64(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function mac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
export async function sign(env, value) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Problem('管理者認証の設定がまだ完了していません。', 503);
  const payload = b64(encoder.encode(JSON.stringify(value)));
  return `${payload}.${await mac(env.SESSION_SECRET, payload)}`;
}
export async function verify(env, token) {
  if (!env.SESSION_SECRET || !token) return null;
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra || !signature) return null;
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, unb64(signature), encoder.encode(payload))) return null;
    const value = JSON.parse(new TextDecoder().decode(unb64(payload)));
    return value.exp > Date.now() ? value : null;
  } catch { return null; }
}
function cookie(req, name) { return (req.headers.get('Cookie') || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`))?.slice(name.length + 1); }
const setCookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export async function isAdmin(req, env) {
  if (env.LOCAL_DEV === '1' && ['localhost', '127.0.0.1'].includes(new URL(req.url).hostname)) return true;
  const session = await verify(env, cookie(req, '__Host-emupi_admin'));
  return !!env.ADMIN_EMAIL && session?.kind === 'admin' && session.email === env.ADMIN_EMAIL.toLowerCase();
}
export async function auth(req, env) {
  const url = new URL(req.url), callback = `${url.origin}/auth/callback`;
  if (url.pathname === '/auth/login') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.ADMIN_EMAIL) throw new Problem('Googleログインの設定がまだ完了していません。', 503);
    const nonce = crypto.randomUUID(), state = crypto.randomUUID(), verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
    const token = await sign(env, { state, nonce, verifier, exp: Date.now() + 600000 });
    const to = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callback, response_type: 'code', scope: 'openid email', state, nonce, code_challenge: await hash(verifier), code_challenge_method: 'S256' })) to.searchParams.set(key, value);
    return new Response(null, { status: 302, headers: { Location: to.href, 'Set-Cookie': setCookie('__Host-emupi_oauth', token, 600), 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/auth/callback') {
    const flow = await verify(env, cookie(req, '__Host-emupi_oauth'));
    if (!flow || flow.state !== url.searchParams.get('state') || !url.searchParams.get('code')) throw new Problem('ログインの有効期限が切れました。もう一度お試しください。', 401);
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: callback, code: url.searchParams.get('code'), grant_type: 'authorization_code', code_verifier: flow.verifier }) });
    const token = await response.json();
    if (!response.ok || !token.id_token) throw new Problem('Googleログインに失敗しました。', 401);
    // Verify Google's signature and the claims locally, never trust a decoded-only ID token.
    const [header, payload, signature] = token.id_token.split('.');
    const metadata = JSON.parse(new TextDecoder().decode(unb64(header)));
    if (metadata.alg !== 'RS256') throw new Problem('認証方式を確認できませんでした。', 401);
    const keys = await (await fetch('https://www.googleapis.com/oauth2/v3/certs', { cf: { cacheTtl: 3600 } })).json();
    const jwk = keys.keys?.find(k => k.kid === metadata.kid);
    if (!jwk) throw new Problem('認証キーを確認できませんでした。', 401);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(signature), encoder.encode(`${header}.${payload}`))) throw new Problem('認証結果を確認できませんでした。', 401);
    const claims = JSON.parse(new TextDecoder().decode(unb64(payload)));
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID || claims.exp * 1000 <= Date.now() || claims.nonce !== flow.nonce || claims.email_verified !== true || claims.email?.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) throw new Problem('このアカウントには管理権限がありません。', 403);
    const headers = new Headers({ Location: '/admin/', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', setCookie('__Host-emupi_admin', await sign(env, { kind: 'admin', email: claims.email.toLowerCase(), exp: Date.now() + 43200000 }), 43200));
    headers.append('Set-Cookie', setCookie('__Host-emupi_oauth', '', 0));
    return new Response(null, { status: 302, headers });
  }
  if (url.pathname === '/auth/logout' && req.method === 'POST') return new Response(null, { status: 204, headers: { 'Set-Cookie': setCookie('__Host-emupi_admin', '', 0) } });
  throw new Problem('ページが見つかりません。', 404);
}
