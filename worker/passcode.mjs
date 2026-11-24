import { hash, matchesPassword, passwordRecord, setCookie, sign } from './auth.mjs';
import { nameKey, Problem, text } from './domain.mjs';
import { sessionCookie } from './line-login.mjs';

const sessionAge = 30 * 86400;
const attemptWindow = 15 * 60_000;

export async function passcodeAuth(env, action, input) {
  if (!(env.SESSION_SECRET?.length >= 32)) throw new Problem('パスコードは現在利用できません。', 503);
  const name = text(input?.name, 'Pocochaの名前', 50);
  const key = nameKey(name);
  if (typeof input?.passcode !== 'string' || !/^\d{4}$/.test(input.passcode)) {
    throw new Problem('パスコードは半角数字4桁で入力してください。');
  }
  const credential = JSON.stringify([env.SESSION_SECRET, 'listener-passcode', key, input.passcode]);
  let record;
  if (action === 'register') {
    record = await env.DB.prepare('INSERT INTO listener_passcodes (name_key, name, account_id, pin_record) VALUES (?, ?, ?, ?) ON CONFLICT(name_key) DO NOTHING RETURNING name, account_id')
      .bind(key, name, crypto.randomUUID(), await passwordRecord(credential)).first();
    if (!record) throw new Problem('この名前にはパスコードが設定されています。「パスコードでログイン」を選んでください。', 409);
  } else {
    const bucket = Math.floor(Date.now() / attemptWindow);
    const limitKey = await hash(JSON.stringify([env.SESSION_SECRET, 'passcode-attempt', key, bucket]));
    const attempt = await env.DB.prepare('INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count')
      .bind(limitKey, (bucket + 1) * attemptWindow).first();
    if (attempt.count > 5) throw new Problem('入力回数の上限です。しばらく待ってからお試しください。', 429);
    record = await env.DB.prepare('SELECT name, account_id, pin_record FROM listener_passcodes WHERE name_key = ?').bind(key).first();
    const matches = await matchesPassword(credential, record?.pin_record || 'passcode-dummy-salt.passcode-dummy-hash');
    if (!record || !matches) throw new Problem('Pocochaの名前かパスコードが違います。', 401);
  }
  const token = await sign(env, { kind:'pin-listener', accountId:record.account_id, name:record.name, exp:Date.now()+sessionAge*1000 });
  return new Response(JSON.stringify({ name:record.name }), { headers:{
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'Set-Cookie':setCookie(sessionCookie, token, sessionAge)
  } });
}
