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

const sessionAge = 30 * 86400;
export async function passwordKey(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
export async function passwordRecord(password, salt = b64(crypto.getRandomValues(new Uint8Array(24)))) {
  return salt + '.' + await passwordKey(password, salt);
}
export async function isAdmin(req, env) {
  if (env.LOCAL_DEV === '1' && ['localhost', '127.0.0.1'].includes(new URL(req.url).hostname)) return true;
  const session = await verify(env, cookie(req, '__Host-emupi_admin'));
  return !!env.ADMIN_PASSWORD_HASH && session?.kind === 'admin' && session.passwordVersion === await hash(env.ADMIN_PASSWORD_HASH);
}
export async function auth(req, env) {
  const url = new URL(req.url);
  if (req.method !== 'POST') throw new Problem('ページが見つかりません。', 404);
  if (req.headers.get('Origin') !== url.origin) throw new Problem('管理画面から操作してください。', 403);
  if (url.pathname === '/auth/logout') return new Response(null, {status:204,headers:{'Set-Cookie':setCookie('__Host-emupi_admin','',0),'Cache-Control':'no-store'}});
  if (url.pathname !== '/auth/login') throw new Problem('ページが見つかりません。',404);
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) throw new Problem('パスワードの設定がまだ完了していません。',503);
  if (!(req.headers.get('Content-Type') || '').startsWith('application/json')) throw new Problem('送信形式を確認してください。',415);
  const bucket = Math.floor(Date.now()/900000);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const key = await hash(env.SESSION_SECRET+':login:'+ip+':'+bucket);
  const attempt = await env.DB.prepare('INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key,Date.now()+1800000).first();
  if (attempt.count > 10) throw new Problem('ログインの試行が続いています。15分ほど待ってお試しください。',429);
  const raw = await req.text();
  if (raw.length>2048) throw new Problem('入力が長すぎます。',413);
  let input;try {input=JSON.parse(raw);}catch{throw new Problem('パスワードを入力してください。');}
  if(typeof input?.password !== 'string' || !input.password || input.password.length>256) throw new Problem('パスワードを入力してください。');
  const [salt,expected] = env.ADMIN_PASSWORD_HASH.split('.');
  if(!salt || !expected) throw new Problem('パスワード設定を確認してください。',503);
  const actual = await passwordKey(input.password,salt);
  // Compare fixed-length digests with Web Crypto's HMAC verifier.
  const compareKey = await crypto.subtle.importKey('raw',encoder.encode(expected),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const signature = await crypto.subtle.sign('HMAC',compareKey,encoder.encode(actual));
  if (!await crypto.subtle.verify('HMAC',compareKey,signature,encoder.encode(expected))) throw new Problem('パスワードが違います。',401);
  const token = await sign(env,{kind:'admin',passwordVersion:await hash(env.ADMIN_PASSWORD_HASH),exp:Date.now()+sessionAge*1000});
  return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Set-Cookie':setCookie('__Host-emupi_admin',token,sessionAge)}});
}
