import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { database } from '../scripts/local-db.mjs';

const origin = 'https://requests.example';
const token = 'r'.repeat(40);
const key = ' Ｌｉｓｔｅｎｅｒ ';
const environment = () => ({ DB:database(), SESSION_SECRET:'s'.repeat(40) });

function send(env, path, { method = 'GET', data, cookie, requestToken, ip } = {}) {
  const headers = { Origin:origin, 'Content-Type':'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (requestToken) headers['X-Request-Token'] = requestToken;
  if (ip) headers['CF-Connecting-IP'] = ip;
  return worker.fetch(new Request(origin + path, {method, headers, body:data && JSON.stringify(data)}), env);
}

test('パスコードのログインで別端末から編集でき、ログアウト後は元の応募トークンも編集に使えない', async () => {
  const env = environment();
  const register = await send(env, '/api/passcode/register', {
    method:'POST', data:{name:key, passcode:'0123'}
  });
  assert.equal(register.status, 200);
  const firstCookie = register.headers.get('Set-Cookie').split(';')[0];
  const duplicate = await send(env, '/api/passcode/register', {
    method:'POST', data:{name:'listener', passcode:'4567'}
  });
  assert.equal(duplicate.status, 409);
  const submit = await send(env, '/api/requests', {
    method:'POST', cookie:firstCookie, requestToken:token, data:{name:'Listener', artist:'山下智久', song:'Loveless'}
  });
  assert.equal(submit.status, 201);
  const { id } = (await submit.json()).entry;
  const edit = { action:'editSong', artist:'山下智久', song:'抱いてセニョリータ' };
  assert.equal((await send(env, '/api/mine', {method:'PATCH', requestToken:token, data:edit})).status, 401);
  const login = await send(env, '/api/passcode/login', {
    method:'POST', data:{name:'listener', passcode:'0123'}
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const account = await (await send(env, '/api/listener-account', {cookie})).json();
  assert.equal(account.receipts[0].songEditable, true);
  assert.equal((await send(env, '/api/mine', {method:'PATCH', cookie, data:{...edit, requestId:id}})).status, 200);
  const details = await (await send(env, '/api/requests-by-name', {method:'POST', data:{name:'Listener'}})).json();
  assert.equal(details.entries[0].song, '抱いてセニョリータ');
});

test('パスコードの試行回数は端末やIPを変えても同じ名前で制限する', async () => {
  const env = environment();
  assert.equal((await send(env, '/api/passcode/register', {method:'POST', data:{name:key, passcode:'1234'}})).status, 200);
  for (let i = 1; i <= 5; i++) {
    const response = await send(env, '/api/passcode/login', {
      method:'POST', ip:`192.0.2.${i}`, data:{name:'Listener', passcode:'0987'}
    });
    assert.equal(response.status, 401);
  }
  const blocked = await send(env, '/api/passcode/login', {
    method:'POST', ip:'192.0.2.10', data:{name:'listener', passcode:'1234'}
  });
  assert.equal(blocked.status, 429);
});
