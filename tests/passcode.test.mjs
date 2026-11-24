import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { mutate } from '../worker/index.mjs';
import { adminAction, submit } from '../worker/domain.mjs';
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
  const entry = await send(env, '/api/passcode/entry', {method:'POST', data:{name:'listener'}});
  assert.equal((await entry.json()).requiresPasscode, true);
  const guest = await send(env, '/api/passcode/entry', {method:'POST', data:{name:'新規ゲスト'}});
  assert.equal((await guest.json()).requiresPasscode, false);
  const duplicate = await send(env, '/api/passcode/register', {
    method:'POST', data:{name:'listener', passcode:'4567'}
  });
  assert.equal(duplicate.status, 409);
  const request = {name:'Listener', artist:'山下智久', song:'Loveless'};
  const blocked = await send(env, '/api/requests', {method:'POST', requestToken:token, data:request});
  assert.equal(blocked.status, 401);
  assert.equal((await blocked.json()).code, 'passcode_required');
  const submit = await send(env, '/api/requests', {method:'POST', cookie:firstCookie, requestToken:token, data:request});
  assert.equal(submit.status, 201);
  const { id } = (await submit.json()).entry;
  const edit = { action:'editSong', artist:'山下智久', song:'抱いてセニョリータ' };
  assert.equal((await send(env, '/api/mine', {method:'PATCH', requestToken:token, data:edit})).status, 401);
  const login = await send(env, '/api/passcode/login', {
    method:'POST', data:{name:'listener', passcode:'0123'}
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  await mutate(env, state => adminAction(state, {action:'draw'}));
  const selected = await (await send(env, '/api/listener-account', {cookie})).json();
  assert.equal(selected.receipts[0].songEditable, false);
  await mutate(env, state => adminAction(state, {action:'undo'}));
  const account = await (await send(env, '/api/listener-account', {cookie})).json();
  assert.equal(account.receipts[0].status, 'pending');
  assert.equal(account.receipts[0].songEditable, true);
  assert.equal((await send(env, '/api/mine', {method:'PATCH', cookie, data:{...edit, requestId:id}})).status, 200);
  const details = await (await send(env, '/api/requests-by-name', {method:'POST', data:{name:'Listener'}})).json();
  assert.equal(details.entries[0].song, '抱いてセニョリータ');
});

test('過去に使われた名前のパスコードは送信時のトークンがあるブラウザーで設定する', async () => {
  const env = environment();
  assert.equal((await send(env, '/api/requests', {
    method:'POST', requestToken:token, data:{name:'Listener', artist:'山下智久', song:'Loveless'}
  })).status, 201);
  const register = tokens => send(env, '/api/passcode/register', {
    method:'POST', data:{name:key, passcode:'0123', tokens}
  });
  assert.equal((await register([])).status, 409);
  assert.equal((await register([token])).status, 200);
});

test('以前の未連携リクエストは送信時のデータがないブラウザーでもパスコードログインで管理できる', async () => {
  const env = environment();
  const register = await send(env, '/api/passcode/register', {method:'POST', data:{name:key, passcode:'0123'}});
  assert.equal(register.status, 200);
  const record = await env.DB.prepare('SELECT account_id FROM listener_passcodes WHERE name_key = ?').bind('listener').first();
  await mutate(env, state => {
    const entry = submit(state, {name:'Listener', artist:'山下智久', song:'Loveless'}, 'legacy-owned');
    entry.accountId = record.account_id;
    submit(state, {name:'Listener', artist:'星野源', song:'恋'}, 'legacy-guest');
    const foreign = submit(state, {name:'Listener', artist:'山下智久', song:'予約曲', round:2}, 'legacy-foreign');
    foreign.accountId = 'another-account';
  });
  const signIn = async () => send(env, '/api/passcode/login', {method:'POST', data:{name:'listener', passcode:'0123'}});
  const login = await signIn();
  assert.equal(login.status, 200);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const { receipts } = await (await send(env, '/api/listener-account', { cookie })).json();
  assert.deepEqual(receipts.map(entry => entry.song), ['Loveless','恋']);
  const edit = await send(env, '/api/mine', {
    method:'PATCH', cookie, data:{action:'editSong', requestId:receipts[1].id, artist:'星野源', song:'SUN'}
  });
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).entry.song, 'SUN');
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

test('公式サイトでパスコードログインするとCookieなしで両枠の曲を修正できる', async () => {
  const env = { ...environment(), PUBLIC_ORIGIN:'https://emupi2020.github.io' };
  const credentials = { name:'Listener', passcode:'0123' };
  const official = (path, { method = 'GET', data, session, requestToken } = {}) => worker.fetch(
    new Request(origin + path, {
      method, body:data && JSON.stringify(data), headers:{
        Origin:env.PUBLIC_ORIGIN,
        ...(data && {'Content-Type':'application/json'}),
        ...(requestToken && {'X-Request-Token':requestToken}),
        ...(session && {Authorization:'Bearer ' + session})
      }
    }), env);
  const registration = await official('/api/passcode/register', {method:'POST', data:credentials});
  assert.equal(registration.status, 200);
  assert.equal(registration.headers.get('Access-Control-Allow-Origin'), env.PUBLIC_ORIGIN);
  assert.match(registration.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
  const {sessionToken} = await registration.json();
  assert.ok(sessionToken);
  const requests = [
    {artist:'山下智久', song:'Loveless', category:'yamapi'},
    {artist:'星野源', song:'恋', category:'other'}
  ];
  for (const request of requests) {
    const response = await official('/api/requests', {method:'POST', data:{name:credentials.name, ...request}, session:sessionToken, requestToken:crypto.randomUUID()});
    assert.equal(response.status, 201);
  }
  const login = await official('/api/passcode/login', {method:'POST', data:credentials});
  assert.equal(login.status, 200);
  const {sessionToken: newSession} = await login.json();
  const account = await (await official('/api/listener-account', {session:newSession})).json();
  assert.equal(account.receipts.length, 2);
  for (const entry of account.receipts) {
    assert.equal(entry.songEditable, true);
    const edited = await official('/api/mine', {method:'PATCH', data:{
      action:'editSong', requestId:entry.id, artist:entry.artist, song:entry.song + ' ライブ版'
    }, session:newSession});
    assert.equal(edited.status, 200);
  }
  const unrelated = await worker.fetch(new Request(origin + '/api/listener-account', {
    headers:{Origin:'https://other.example', Authorization:'Bearer ' + newSession}
  }), env);
  assert.equal((await unrelated.json()).signedIn, false);
  assert.equal((await official('/auth/line/logout', {method:'POST', data:{}, session:newSession})).status, 200);
});
