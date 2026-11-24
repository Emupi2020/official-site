import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { hash, sign } from '../worker/auth.mjs';
import { database } from '../scripts/local-db.mjs';

const origin = 'https://requests.example';
const token = 'r'.repeat(40);
const env = () => ({
  DB: database(), SESSION_SECRET: 's'.repeat(40), LINE_CHANNEL_ID: '1234', LINE_CHANNEL_SECRET: 'test-only'
});

function request(path, { method = 'GET', cookie, token, data } = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (token) headers['X-Request-Token'] = token;
  return new Request(origin + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
}

test('LINEログインはブラウザーのstateとPKCEを検証し、LINE照合済みのIDでログインする', async t => {
  const e = env();
  const start = await worker.fetch(request('/auth/line/start'), e);
  assert.equal(start.status, 303);
  const authorize = new URL(start.headers.get('Location'));
  assert.equal(authorize.origin, 'https://access.line.me');
  assert.equal(authorize.searchParams.get('scope'), 'openid');
  const cookie = start.headers.get('Set-Cookie').split(';')[0];
  const callback = '/auth/line/callback?code=code&state=';
  const invalid = await worker.fetch(request(callback + 'bad', { cookie }), e);
  assert.equal(invalid.headers.get('Location'), '/?line=failed');
  const remote = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const form = options.body;
    if (url === 'https://api.line.me/oauth2/v2.1/token') {
      assert.equal(await hash(form.get('code_verifier')), authorize.searchParams.get('code_challenge'));
      assert.equal(form.get('redirect_uri'), origin + '/auth/line/callback');
      return Response.json({ id_token: 'test-token' });
    }
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    assert.equal(form.get('id_token'), 'test-token');
    assert.equal(form.get('nonce'), authorize.searchParams.get('nonce'));
    return Response.json({ iss: 'https://access.line.me', aud: e.LINE_CHANNEL_ID, sub: 'test-subject', nonce: form.get('nonce') });
  });
  const signedIn = await worker.fetch(request(callback + authorize.searchParams.get('state'), { cookie }), e);
  assert.equal(signedIn.headers.get('Location'), '/?line=connected');
  assert.equal(remote.mock.callCount(), 2);
  const session = signedIn.headers.getSetCookie().find(value => value.startsWith('__Host-emupi_listener=')).split(';')[0];
  const status = await worker.fetch(request('/api/listener-account', { cookie: session }), e);
  assert.equal((await status.json()).signedIn, true);
  const logout = await worker.fetch(request('/auth/line/logout', { method: 'POST', cookie: session }), e);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('LINE連携後は元の端末でもログインが必須で、別端末から本人だけが曲を編集できる', async () => {
  const e = env();
  const session = async accountId => '__Host-emupi_listener=' + await sign(e, {
    kind: 'line-listener', channel: e.LINE_CHANNEL_ID, accountId, exp: Date.now() + 60_000
  });
  const cookie = await session('listener-a');
  const other = await session('listener-b');
  const submit = await worker.fetch(request('/api/requests', {
    method: 'POST', token, data: { name: 'リスナー', artist: '山下智久', song: 'Loveless' }
  }), e);
  assert.equal(submit.status, 201);
  const { id } = (await submit.json()).entry;
  const edit = (data, proof) => worker.fetch(request('/api/mine', {
    method: 'PATCH', ...proof, data: { action: 'editSong', artist: '山下智久', song: '抱いてセニョリータ', ...data }
  }), e);
  assert.equal((await edit({}, { token })).status, 200);
  const linked = await worker.fetch(request('/api/listener-account', { method: 'POST', cookie, data: { tokens: [token] } }), e);
  assert.equal((await linked.json()).linked, 1);
  assert.equal((await edit({}, { token })).status, 401);
  assert.equal((await edit({}, { token, cookie: other })).status, 401);
  assert.equal((await edit({ requestId: id }, { cookie: other })).status, 404);
  assert.equal((await edit({ requestId: id }, { cookie })).status, 200);
  const mine = await worker.fetch(request('/api/mine', { token }), e);
  assert.equal((await mine.json()).entry.songEditable, false);
  const owned = await worker.fetch(request('/api/listener-account', { cookie }), e);
  assert.equal((await owned.json()).receipts[0].songEditable, true);
  const nameLookup = await worker.fetch(request('/api/requests-by-name', {
    method: 'POST', data: { name: 'リスナー' }
  }), e);
  assert.equal((await nameLookup.json()).entries[0].song, '抱いてセニョリータ');
});
