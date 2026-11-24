import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { database } from '../scripts/local-db.mjs';

test('公式ページから送った報告は管理者だけが本文を読める', async () => {
  const origin = 'https://emupi2020.github.io';
  const env = { DB:database(), PUBLIC_ORIGIN:origin, SESSION_SECRET:'s'.repeat(40) };
  const makeReport = (message, name = 'えむぴー確認') => worker.fetch(new Request('https://requests.example/api/bug-reports', {
    method:'POST', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({name, message})
  }), env);
  assert.equal((await makeReport('   ')).status, 400);
  assert.equal((await makeReport('あ'.repeat(1001))).status, 400);
  const message = '報告の1行目\n<i>2行目</i>';
  assert.equal((await makeReport(message, '')).status, 400);
  const response = await makeReport(message);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.deepEqual(await response.json(), {ok:true});
  assert.equal((await worker.fetch(new Request('https://requests.example/api/admin/bug-reports'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://requests.example/api/bug-reports'), env)).status, 404);
  const row = env.DB.native.prepare('SELECT name, message FROM bug_reports').get();
  assert.equal(row.name, 'えむぴー確認');
  assert.equal(row.message, message);
  assert.equal(env.DB.native.prepare('SELECT COUNT(*) AS n FROM app_state').get().n, 0);
});
