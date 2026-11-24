import { hash, matchesPassword, passwordRecord, setCookie, sign } from './auth.mjs';
import { nameKey, Problem, text } from './domain.mjs';
import { sessionCookie } from './line-login.mjs';

const sessionAge = 30 * 86400;
const attemptWindow = 15 * 60_000;
export const passcodeRequiredMessage = 'この名前にはパスコードが設定されています。';
const credentialFor = (env, key, pin) => JSON.stringify([env.SESSION_SECRET, 'listener-passcode', key, pin]);

export function passcodeAccount(env, accountId) {
  return env.DB.prepare('SELECT name_key, name, pin_record FROM listener_passcodes WHERE account_id = ?').bind(accountId).first();
}

async function verifyPasscode(env, key, pin, record) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new Problem('パスコードは半角数字4桁で入力してください。');
  const bucket = Math.floor(Date.now() / attemptWindow);
  const limitKey = await hash(JSON.stringify([env.SESSION_SECRET, 'passcode-attempt', key, bucket]));
  const attempt = await env.DB.prepare('INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(limitKey, (bucket + 1) * attemptWindow).first();
  if (attempt.count > 5) throw new Problem('入力回数の上限です。しばらく待ってからお試しください。', 429);
  return matchesPassword(credentialFor(env, key, pin), record || 'passcode-dummy-salt.passcode-dummy-hash');
}

export async function preparePasscodeRename(env, accountId, input) {
  const previous = await passcodeAccount(env, accountId);
  if (!previous) throw new Problem('パスコードでログインしてください。', 401);
  const name = text(input?.name, 'Pocochaの名前', 50);
  const key = nameKey(name);
  if (!await verifyPasscode(env, previous.name_key, input?.passcode, previous.pin_record)) {
    throw new Problem('パスコードが違います。', 401);
  }
  return {previous, name, key, pinRecord:await passwordRecord(credentialFor(env, key, input.passcode))};
}

export async function passcodeAccountId(env, name) {
  const key = nameKey(text(name, 'Pocochaの名前', 50));
  return (await env.DB.prepare('SELECT account_id FROM listener_passcodes WHERE name_key = ?').bind(key).first())?.account_id ?? null;
}

export async function passcodeAuth(env, action, input, fromOfficialSite) {
  if (!(env.SESSION_SECRET?.length >= 32)) throw new Problem('パスコードは現在利用できません。', 503);
  const name = text(input?.name, 'Pocochaの名前', 50);
  const key = nameKey(name);
  if (typeof input?.passcode !== 'string' || !/^\d{4}$/.test(input.passcode)) {
    throw new Problem('パスコードは半角数字4桁で入力してください。');
  }
  let record;
  if (action === 'register') {
    record = await env.DB.prepare('INSERT INTO listener_passcodes (name_key, name, account_id, pin_record) VALUES (?, ?, ?, ?) ON CONFLICT(name_key) DO NOTHING RETURNING name, account_id')
      .bind(key, name, crypto.randomUUID(), await passwordRecord(credentialFor(env, key, input.passcode))).first();
    if (!record) throw new Problem(passcodeRequiredMessage, 409, 'passcode_required');
  } else {
    record = await env.DB.prepare('SELECT name, account_id, pin_record FROM listener_passcodes WHERE name_key = ?').bind(key).first();
    const matches = await verifyPasscode(env, key, input.passcode, record?.pin_record);
    if (!record || !matches) throw new Problem('Pocochaの名前かパスコードが違います。', 401);
  }
  const token = await sign(env, { kind:'pin-listener', accountId:record.account_id, name:record.name, exp:Date.now()+sessionAge*1000 });
  const data = fromOfficialSite ? { name:record.name, sessionToken:token } : { name:record.name };
  const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' };
  if (!fromOfficialSite) headers['Set-Cookie'] = setCookie(sessionCookie, token, sessionAge);
  const response = new Response(JSON.stringify(data), { headers });
  return { accountId:record.account_id, name:record.name, response };
}
