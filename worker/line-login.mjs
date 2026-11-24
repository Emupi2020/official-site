import { cookie, hash, setCookie, sign, verify } from './auth.mjs';
import { Problem } from './domain.mjs';

const transactionCookie = '__Host-emupi_line_flow';
const sessionCookie = '__Host-emupi_listener';
const flowAge = 600;
const sessionAge = 30 * 86400;
const random = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

export const lineEnabled = env => Boolean(env.LINE_CHANNEL_ID && env.LINE_CHANNEL_SECRET && env.SESSION_SECRET?.length >= 32);

export async function listenerId(req, env) {
  if (!lineEnabled(env)) return null;
  const session = await verify(env, cookie(req, sessionCookie));
  return session?.kind === 'line-listener' && session.channel === env.LINE_CHANNEL_ID ? session.accountId : null;
}

function redirect(location, ...cookies) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

async function lineRequest(action, data) {
  const response = await fetch(`https://api.line.me/oauth2/v2.1/${action}`, {
    method: 'POST', body: new URLSearchParams(data)
  });
  if (!response.ok) throw new Error('LINE authentication failed');
  return response.json();
}

export async function lineAuth(req, env) {
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname === '/auth/line/logout') {
    if (req.headers.get('Origin') !== url.origin) throw new Problem('リクエスト画面から操作してください。', 403);
    return new Response('{}', { headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Set-Cookie': setCookie(sessionCookie, '', 0)
    } });
  }
  if (req.method !== 'GET' || !lineEnabled(env)) throw new Problem('LINE連携は現在利用できません。', 404);
  const callback = new URL('/auth/line/callback', url).href;
  if (url.pathname === '/auth/line/start') {
    const flow = { kind: 'line-flow', state: random(), nonce: random(), verifier: random(), exp: Date.now() + flowAge * 1000 };
    const params = new URLSearchParams({
      response_type: 'code', client_id: env.LINE_CHANNEL_ID, redirect_uri: callback, scope: 'openid',
      state: flow.state, nonce: flow.nonce, code_challenge: await hash(flow.verifier), code_challenge_method: 'S256'
    });
    return redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`, setCookie(transactionCookie, await sign(env, flow), flowAge));
  }
  if (url.pathname !== '/auth/line/callback') throw new Problem('ページが見つかりません。', 404);
  const expired = setCookie(transactionCookie, '', 0);
  const flow = await verify(env, cookie(req, transactionCookie));
  const code = url.searchParams.get('code');
  if (flow?.kind !== 'line-flow' || flow.state !== url.searchParams.get('state') || !code || url.searchParams.has('error')) {
    return redirect('/?line=failed', expired);
  }
  try {
    const token = await lineRequest('token', {
      grant_type: 'authorization_code', code, redirect_uri: callback, client_id: env.LINE_CHANNEL_ID,
      client_secret: env.LINE_CHANNEL_SECRET, code_verifier: flow.verifier
    });
    if (typeof token.id_token !== 'string' || !token.id_token) throw new Error('LINE ID token missing');
    const id = await lineRequest('verify', { id_token: token.id_token, client_id: env.LINE_CHANNEL_ID, nonce: flow.nonce });
    if (id.iss !== 'https://access.line.me' || id.aud !== env.LINE_CHANNEL_ID || id.nonce !== flow.nonce || typeof id.sub !== 'string' || !id.sub) {
      throw new Error('LINE ID token verification failed');
    }
    const accountId = await hash(`line:${env.LINE_CHANNEL_ID}:${id.sub}`);
    const session = await sign(env, { kind: 'line-listener', channel: env.LINE_CHANNEL_ID, accountId, exp: Date.now() + sessionAge * 1000 });
    return redirect('/?line=connected', expired, setCookie(sessionCookie, session, sessionAge));
  } catch {
    return redirect('/?line=failed', expired);
  }
}
