import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, submit, rename, adminAction, eligible, publicState, ownRequests, songIdentity, songStatus, prune } from '../worker/domain.mjs';
import worker from '../worker/index.mjs';
import { database } from '../scripts/local-db.mjs';
import { sign,verify,isAdmin,passwordRecord,hash } from '../worker/auth.mjs';
const input=(name='リスナーA',song='らぶれす',artist='やまぴー')=>({name,song,artist});
function state(){const s=initialState();s.open=true;return s;}
test('歌唱済み一覧には実際に消化した曲だけを匿名で公開、戻すも反映',()=>{
  const s=state();submit(s,input('非公開名A'),'secret-a');submit(s,input('非公開名B'),'secret-b');adminAction(s,{action:'advance'});assert.equal(publicState(s).played.length,0);adminAction(s,{action:'advance'});const p=publicState(s).played;assert.equal(p.length,1);assert(p[0].performedAt>0);assert(!JSON.stringify(p).includes('非公開'));assert(!JSON.stringify(p).includes('secret'));adminAction(s,{action:'undo'});assert.equal(publicState(s).played.length,0);
});
test('自分の履歴は自分のトークン分だけ、他人の名前とトークンは返さない',()=>{
  const s=state();submit(s,input('A'),'a');submit(s,input('B'),'b');const list=ownRequests(s,['a']);assert.equal(list.length,1);assert.equal(list[0].status,'pending');assert(!('name'in list[0]));assert(!('tokenHash'in list[0]));assert.equal(ownRequests(s,['unknown']).length,0);adminAction(s,{action:'advance'});adminAction(s,{action:'advance'});assert(ownRequests(s,['a','b']).every(e=>e.playedThisSession));
});
test('知らない・次回保留は歌唱済みに入れず、配信を切り替えると今回の一覧を区切る',()=>{
  const s=state();submit(s,input('A'),'a');adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});assert.equal(publicState(s).played.length,0);adminAction(s,{action:'session'});adminAction(s,{action:'advance'});adminAction(s,{action:'advance'});assert.equal(publicState(s).played.length,1);adminAction(s,{action:'session'});assert.equal(publicState(s).played.length,0);assert.equal(s.history.length,1);
});
test('知らないは当選分と同曲全件を保留し次回は全件復帰、記録は残る',()=>{
  const s=state();submit(s,input('A'),'a');submit(s,input('B','Loveless','山下智久'),'b');adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});
  assert.equal(s.entries.filter(e=>e.status==='deferred').length,2);assert.equal(eligible(s).length,0);const at=songStatus(s,'やまぴー','らぶれす').unknownAt;assert(at>0);
  assert(s.round>=2);assert.equal(eligible(s).length,0);adminAction(s,{action:'session'});assert.equal(eligible(s).length,2);assert.equal(songStatus(s,'山下智久','Loveless').unknownAt,at);
});
test('知らない曲は確認必須、同名別歌手は警告なし、同意後も当日は保留',()=>{
  const s=state();submit(s,input('A'),'a');adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});const at=songStatus(s,'山下智久','Loveless').unknownAt;
  assert.equal(songStatus(s,'別歌手','Loveless').unknownAt,null);assert.throws(()=>submit(s,input('B'),'b'),/記録を確認/);assert.throws(()=>submit(s,{...input('B'),unknownAcknowledgedAt:at-1},'b'),/記録を確認/);
  const e=submit(s,{...input('B'),unknownAcknowledgedAt:at},'b');assert.equal(e.status,'deferred');assert.equal(e.deferReason,'unknown');
});
test('次を回すで歌唱記録と次の抽選が確定し、戻すで両方を復元',()=>{
  const s=state();const a=submit(s,input('A'),'a');adminAction(s,{action:'advance'});const b=submit(s,input('B','別の曲'),'b');adminAction(s,{action:'advance'});assert.equal(a.status,'done');assert.equal(s.current,b.id);adminAction(s,{action:'undo'});assert.equal(s.current,a.id);assert.equal(a.status,'selected');assert.equal(b.status,'pending');assert.equal(s.sung.length,0);
});
test('最後の1曲でも次を回すで消化・習得更新、戻すで日時付き記録も復元',()=>{
  const s=state();submit(s,input('A'),'a');adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});const at=songStatus(s,'山下智久','Loveless').unknownAt;adminAction(s,{action:'session'});adminAction(s,{action:'advance'});adminAction(s,{action:'advance'});assert.equal(s.entries[0].status,'done');assert.equal(songStatus(s,'山下智久','Loveless').unknownAt,null);adminAction(s,{action:'undo'});assert.equal(s.entries[0].status,'selected');assert.equal(songStatus(s,'山下智久','Loveless').unknownAt,at);
});
test('知らないの取り消しで後着の確認済みリクエストも抽選に戻る',()=>{
  const s=state();submit(s,input('A'),'a');adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});const at=songStatus(s,'山下智久','Loveless').unknownAt;submit(s,{...input('B'),unknownAcknowledgedAt:at},'b');adminAction(s,{action:'undo'});assert.equal(s.entries[0].status,'selected');assert.equal(s.entries[1].status,'pending');assert.equal(songStatus(s,'山下智久','Loveless').unknownAt,null);
});
test('後日もう一度知らないなら記録日時が更新され古い確認では送れない',()=>{
  const s=state();submit(s,input('A'),'a');adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});const at=songStatus(s,'山下智久','Loveless').unknownAt;adminAction(s,{action:'session'});adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});assert(songStatus(s,'山下智久','Loveless').unknownAt>at);assert.throws(()=>submit(s,{...input('B'),unknownAcknowledgedAt:at},'b'),/記録を確認/);
});
test('以前の保存データに新項目がなくても知らない機能を使える',()=>{
  const s=state();delete s.unknown;delete s.held;submit(s,input(),'a');adminAction(s,{action:'advance'});adminAction(s,{action:'unknown'});assert.equal(s.entries[0].status,'deferred');assert(songStatus(s,'山下智久','Loveless').unknownAt);
});
test('同名再送・歌唱済み再応募を拒否、次の回は応募可能',()=>{const s=state();submit(s,input(),'one');assert.throws(()=>submit(s,input(' リスナーA '),'two'),/リクエスト済み/);adminAction(s,{action:'draw'});adminAction(s,{action:'done'});assert.equal(s.round,2);submit(s,input(),'four');assert.equal(s.entries.length,2);assert.equal(s.entries[1].status,'deferred');});
test('同じ端末で名前を変えても追加応募できない',()=>{const s=state();submit(s,input(),'one');assert.throws(()=>submit(s,input('別名'),'one'),/リクエスト済み/);});
test('名前修正は1件を更新、旧名枠と変更先の重複制限も保持',()=>{const s=state(),e=submit(s,input(),'one');submit(s,input('リスナーB'),'two');assert.throws(()=>rename(s,e,'リスナーB'),/応募/);rename(s,e,'訂正A');assert.equal(s.entries.length,2);assert.throws(()=>submit(s,input(),'three'),/リクエスト済み/);s.open=false;rename(s,e,'変更');assert.equal(e.name,'変更');});
test('同曲別口、選ばれた1件のみ消化、後着も保留、次回復帰',()=>{const s=state();submit(s,input('A'),'a');submit(s,input('B','Loveless','山下智久'),'b');assert.equal(eligible(s).length,2);adminAction(s,{action:'draw'});adminAction(s,{action:'done'});assert.equal(s.entries.filter(e=>e.status==='done').length,1);assert.equal(s.entries.filter(e=>e.status==='deferred').length,1);submit(s,input('C'),'c');assert.equal(s.entries[2].status,'deferred');assert(s.round>=2);assert.equal(eligible(s).length,0);adminAction(s,{action:'session'});assert.equal(eligible(s).length,2);});
test('抽選後の途中応募は選択済みに割り込まず次回抽選へ',()=>{const s=state();const a=submit(s,input('A'),'a');adminAction(s,{action:'draw'});const b=submit(s,input('B','別の曲'),'b');assert.equal(s.current,a.id);assert.deepEqual(eligible(s).map(e=>e.id),[b.id]);assert.throws(()=>adminAction(s,{action:'draw'}),/歌唱済み/);});
test('歌唱済み取り消しで後着の同曲保留も戻る',()=>{const s=state();submit(s,input('A'),'a');adminAction(s,{action:'draw'});adminAction(s,{action:'done'});submit(s,input('B'),'b');adminAction(s,{action:'undo'});assert.equal(s.entries[0].status,'selected');assert.equal(s.entries[1].status,'pending');assert.equal(s.sung.length,0);});
test('公開API用データから名前・トークン・歌手名つき候補を排除',()=>{const s=state();submit(s,input('非公開の名前'),'PRIVATE_TOKEN');adminAction(s,{action:'draw'});const value=JSON.stringify(publicState(s));assert(!value.includes('非公開'));assert(!value.includes('PRIVATE_TOKEN'));assert(!value.includes('usedNames'));assert(publicState(s).result.artist);});
test('常時受付し、明白なURLスパム・長すぎる入力は拒否、自由表記は受理',()=>{const s=state();assert(submit(s,input(),'a'));assert.throws(()=>submit(s,input('B','https://spam.example'),'b'),/URL/);assert.throws(()=>submit(s,input('C','a'.repeat(101)),'c'),/100/);s.open=false;assert(submit(s,input('D'),'d'));});
test('別歌手の同名曲は統合しない、山Pとらぶれすは同曲',()=>{assert.equal(songIdentity('やまぴー','らぶれす'),songIdentity('山下智久','Loveless'));assert.notEqual(songIdentity('別歌手','Loveless'),songIdentity('山下智久','Loveless'));});
test('30日経過の応募者情報を消し匿名候補は保持',()=>{const s=state();submit(s,input(),'a',Date.now()-31*86400000);prune(s);assert.equal(s.entries.length,0);});
function env(){return{DB:database(),PUBLIC_ORIGIN:'https://emupi2020.github.io',SESSION_SECRET:'x'.repeat(40),ASSETS:{fetch:()=>new Response('static')}};}
function req(path,data,token='a'.repeat(40),origin='https://emupi2020.github.io'){return new Request('https://requests.example'+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Request-Token':token},body:data?JSON.stringify(data):undefined});}
test('実DBの同時応募で同名は1件だけ成功',async()=>{const e=env();const {mutate}=await import('../worker/index.mjs');await mutate(e,s=>{s.open=true;});const results=await Promise.all(Array.from({length:8},(_,i)=>worker.fetch(req('/api/requests',input(),String(i).repeat(40)),e)));assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===409).length,7);});
test('修正トークンなしでは編集用の控えを取得できず変更もできない',async()=>{const e=env();const {mutate}=await import('../worker/index.mjs');await mutate(e,s=>{s.open=true;});await worker.fetch(req('/api/requests',input()),e);const own=await(await worker.fetch(req('/api/mine'),e)).json();assert.equal(own.entry.name,'リスナーA');const other=await(await worker.fetch(req('/api/mine',undefined,'b'.repeat(40)),e)).json();assert.equal(other.entry,null);const update=new Request('https://requests.example/api/mine',{method:'PATCH',headers:{Origin:e.PUBLIC_ORIGIN,'Content-Type':'application/json','X-Request-Token':'b'.repeat(40)},body:JSON.stringify({name:'乗っ取り'})});assert.equal((await worker.fetch(update,e)).status,404);});
test('名前の再入力では一致する受付と予約を閲覧でき、編集情報や期限切れは返さない', async () => {
  const e = env();
  const { mutate } = await import('../worker/index.mjs');
  await mutate(e, state => {
    submit(state, input('別の名前', '別の曲'), 'other');
    submit(state, input('Listener A', '今回の曲'), 'current');
    submit(state, { ...input('Listener A', '予約曲'), round: 2 }, 'reserved');
    submit(state, input('Listener A', '期限切れ', '別の歌手'), 'expired', Date.now() - 31 * 86400000);
  });
  const response = await worker.fetch(req('/api/requests-by-name', {name: ' ＬＩＳＴＥＮＥＲ　Ａ '}, ''), e);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const {entries} = await response.json();
  assert.deepEqual(entries.map(entry => [entry.song, entry.round]), [['今回の曲', 1], ['予約曲', 2]]);
  for (const entry of entries) {
    assert(!('name' in entry) && !('tokenHash' in entry) && !('editable' in entry) && !('songEditable' in entry));
  }
});
test('未認証の管理API・外部Originによる書込みを拒否',async()=>{const e=env();assert.equal((await worker.fetch(req('/api/admin'),e)).status,401);assert.equal((await worker.fetch(req('/api/requests',input(),'a'.repeat(40),'https://evil.example'),e)).status,403);});
test('本人履歴APIはトークンで限定し空・不正な照会で他人を返さない',async()=>{const e=env();const {mutate}=await import('../worker/index.mjs');await mutate(e,s=>{s.open=true;});await worker.fetch(req('/api/requests',input('PRIVATE_NAME')),e);const result=await(await worker.fetch(req('/api/my-requests',{tokens:['a'.repeat(40)]}),e)).json();assert.equal(result.entries.length,1);assert(!JSON.stringify(result).includes('PRIVATE_NAME'));const other=await(await worker.fetch(req('/api/my-requests',{tokens:['b'.repeat(40)]}),e)).json();assert.equal(other.entries.length,0);assert.equal((await worker.fetch(req('/api/my-requests',{tokens:['bad']}),e)).status,400);});
test('管理セッションの署名・期限・パスワード変更を検証',async()=>{const e=env();e.ADMIN_PASSWORD_HASH=await passwordRecord('test-password');const signed=await sign(e,{kind:'admin',passwordVersion:await hash(e.ADMIN_PASSWORD_HASH),exp:Date.now()+60000});assert(await verify(e,signed));assert.equal(await verify(e,signed+'broken'),null);assert.equal(await verify(e,await sign(e,{exp:Date.now()-1})),null);const r=new Request('https://requests.example/api/admin',{headers:{Cookie:`__Host-emupi_admin=${signed}`}});assert(await isAdmin(r,e));e.ADMIN_PASSWORD_HASH=await passwordRecord('changed-password');assert.equal(await isAdmin(r,e),false);});
test('LOCAL_DEVを本番ホストで有効にしても管理権限を与えない',async()=>{const e=env();e.LOCAL_DEV='1';assert.equal(await isAdmin(req('/api/admin'),e),false);});
test('CloudflareのHTML正規化で管理画面がリダイレクトループにならない',async()=>{const e=env();e.ASSETS.fetch=async r=>new URL(r.url).pathname==='/admin'?new Response('admin screen'):Response.redirect('https://requests.example/admin',307);for(const path of ['/admin','/admin/']){const r=await worker.fetch(req(path),e);assert.equal(r.status,200);assert.equal(await r.text(),'admin screen');}});
test('同一IPの過剰送信を制限し匿名APIに応募者情報が出ない',async()=>{const e=env();const {mutate}=await import('../worker/index.mjs');await mutate(e,s=>{s.open=true;});for(let i=0;i<20;i++)await worker.fetch(req('/api/requests',input('名前'+i),String(i).padStart(40,'x')),e);assert.equal((await worker.fetch(req('/api/requests',input('追加'),'z'.repeat(40)),e)).status,429);const text=await(await worker.fetch(req('/api/state'),e)).text();assert(!text.includes('名前'));});

test('音源なしを記録し、翌配信も警告必須で応募は残す',()=>{
 const s=state();submit(s,input('A'),'a');submit(s,input('B'),'b');adminAction(s,{action:'advance'});adminAction(s,{action:'cantSing',reason:'no_audio'});
 const status=songStatus(s,'山下智久','Loveless');assert.deepEqual(status.reasons,[{reason:'no_audio',at:status.unknownAt}]);assert.equal(s.entries.filter(e=>e.status==='deferred').length,2);
 adminAction(s,{action:'session'});assert.equal(eligible(s).length,2);assert.throws(()=>submit(s,input('C'),'c'),/記録を確認/);
 assert.equal(submit(s,{...input('C'),unknownAcknowledgedAt:status.unknownAt},'c').status,'pending');
});
test('理由別日時を保持し古い確認は拒否、歌唱で解除し戻すと両理由を復元',()=>{
 const s=state();submit(s,input('A'),'a');adminAction(s,{action:'advance'});adminAction(s,{action:'cantSing',reason:'unknown'});
 const first=songStatus(s,'山下智久','Loveless');adminAction(s,{action:'session'});adminAction(s,{action:'advance'});adminAction(s,{action:'cantSing',reason:'no_audio'});
 const both=songStatus(s,'山下智久','Loveless');assert.equal(both.reasons.length,2);assert.equal(both.reasons[0].at,first.unknownAt);assert(both.unknownAt>first.unknownAt);
 assert.throws(()=>submit(s,{...input('B'),unknownAcknowledgedAt:first.unknownAt},'b'),/記録を確認/);
 adminAction(s,{action:'undo'});assert.deepEqual(songStatus(s,'山下智久','Loveless'),first);
 adminAction(s,{action:'cantSing',reason:'no_audio'});const restored=songStatus(s,'山下智久','Loveless');adminAction(s,{action:'session'});adminAction(s,{action:'advance'});adminAction(s,{action:'advance'});
 assert.deepEqual(songStatus(s,'山下智久','Loveless').reasons,[]);adminAction(s,{action:'undo'});assert.deepEqual(songStatus(s,'山下智久','Loveless'),restored);
});
test('古い知らない記録の引継ぎと不正な理由の拒否',()=>{
 const s=state();submit(s,input('A'),'a');const key=s.entries[0].songKey;s.unknown[key]={at:123,artist:'山下智久',song:'Loveless'};
 assert.deepEqual(songStatus(s,'山下智久','Loveless').reasons,[{reason:'unknown',at:123}]);adminAction(s,{action:'advance'});
 assert.throws(()=>adminAction(s,{action:'cantSing',reason:'other'}),/理由/);assert.equal(s.entries[0].status,'selected');
 adminAction(s,{action:'cantSing',reason:'no_audio'});assert.equal(songStatus(s,'山下智久','Loveless').reasons[0].at,123);
});

test('パスワードログインから管理APIを利用でき、ログアウトでCookieを消す',async()=>{
 const e=env();e.ADMIN_PASSWORD_HASH=await passwordRecord('correct-password');const login=await worker.fetch(req('/auth/login',{password:'correct-password'},undefined,'https://requests.example'),e);assert.equal(login.status,200);
 const cookie=login.headers.get('Set-Cookie');assert(cookie.includes('HttpOnly'));assert(cookie.includes('Secure'));assert(cookie.includes('SameSite=Lax'));assert(cookie.includes('Max-Age=2592000'));
 const admin=await worker.fetch(new Request('https://requests.example/api/admin',{headers:{Cookie:cookie.split(';')[0]}}),e);assert.equal(admin.status,200);
 const logout=await worker.fetch(req('/auth/logout',{},undefined,'https://requests.example'),e);assert.equal(logout.status,204);assert(logout.headers.get('Set-Cookie').includes('Max-Age=0'));
});
test('間違ったパスワード・外部Originを拒否し、連続ログインを制限',async()=>{
 const e=env();e.ADMIN_PASSWORD_HASH=await passwordRecord('correct-password');
 assert.equal((await worker.fetch(req('/auth/login',{password:'correct-password'}),e)).status,403);
 for(let i=0;i<10;i++){const r=await worker.fetch(req('/auth/login',{password:'incorrect-password'},undefined,'https://requests.example'),e);assert.equal(r.status,401);assert.equal(r.headers.get('Set-Cookie'),null);}
 assert.equal((await worker.fetch(req('/auth/login',{password:'correct-password'},undefined,'https://requests.example'),e)).status,429);
});
test('未設定・入力不正・古いGoogle認証経路はログイン不可',async()=>{
 const e=env();assert.equal((await worker.fetch(req('/auth/login',{password:'x'},undefined,'https://requests.example'),e)).status,503);
 e.ADMIN_PASSWORD_HASH=await passwordRecord('correct-password');assert.equal((await worker.fetch(req('/auth/login',{password:[]},undefined,'https://requests.example'),e)).status,400);
 assert.equal((await worker.fetch(req('/auth/callback'),e)).status,404);
});

test('旧デモURLは端末内データを使わずサーバー版へ誘導する',async()=>{const e=env();for(const path of ['/demo','/demo/','/demo.html']){for(const view of ['admin','request']){const r=await worker.fetch(req(path+'?view='+view),e);assert.equal(r.status,302);assert.equal(r.headers.get('Location'),view==='request'?'/':'/admin/');assert.equal(r.headers.get('Cache-Control'),'no-store');}}});

test('今と次の回に各1件、予約は今の抽選に入らず全件処理後に昇格',()=>{
 const s=state();submit(s,{...input('A','曲A','歌手'),round:1},'a1');submit(s,{...input('A','曲B','歌手'),round:2},'a2');
 assert.equal(eligible(s).length,1);assert.equal(publicState(s).reserved,1);assert.throws(()=>submit(s,{...input('A','曲C','歌手'),round:2},'a3'),/リクエスト済み/);
 assert.throws(()=>submit(s,{...input('B'),round:3},'b'),/切り替わり/);adminAction(s,{action:'advance'});assert.equal(s.entries.find(e=>e.id===s.current).song,'曲A');assert.equal(s.round,1);
 adminAction(s,{action:'advance'});assert.equal(s.round,2);assert.equal(s.entries.find(e=>e.id===s.current).song,'曲B');assert.equal(s.entries[0].status,'done');
 adminAction(s,{action:'undo'});assert.equal(s.round,1);assert.equal(s.entries[0].status,'selected');assert.equal(s.entries[1].status,'pending');assert.equal(eligible(s).length,0);
});
test('最後の曲を歌えない扱いにすると自動切替、途中到着と新たな予約を保存して戻す',()=>{
 const s=state();submit(s,{...input('A','曲A','歌手'),round:1},'a');submit(s,{...input('B','曲B','歌手'),round:2},'b');adminAction(s,{action:'advance'});adminAction(s,{action:'cantSing',reason:'no_audio'});assert.equal(s.round,2);assert.equal(eligible(s).length,1);
 submit(s,{...input('C','曲C','歌手'),round:2},'c');submit(s,{...input('D','曲D','歌手'),round:3},'d');adminAction(s,{action:'undo'});
 assert.equal(s.round,1);assert.equal(s.entries.length,4);assert.equal(s.entries[0].status,'selected');assert.equal(songStatus(s,'歌手','曲A').unknownAt,null);assert.equal(eligible(s).length,0);
});
test('初期空回は飛ばさず、全件消化後は予約がなくても次の回で待つ',()=>{
 const s=initialState();assert.equal(publicState(s).open,true);submit(s,{...input('A','曲A','歌手'),round:2},'a');assert.equal(s.round,1);assert.equal(eligible(s).length,0);
 submit(s,{...input('B','曲B','歌手'),round:1},'b');adminAction(s,{action:'advance'});adminAction(s,{action:'advance'});assert.equal(s.round,2);adminAction(s,{action:'advance'});assert.equal(s.round,3);assert.equal(eligible(s).length,0);
 assert.throws(()=>submit(s,{...input('C'),round:1},'c'),/切り替わり/);assert.throws(()=>adminAction(s,{action:'round'}),/自動/);
});
test('歌唱済みと同曲の予約は当日歌わず、配信を変えると残りだけ復帰',()=>{
 const s=state();submit(s,{...input('A'),round:1},'a');submit(s,{...input('B'),round:2},'b');adminAction(s,{action:'advance'});adminAction(s,{action:'advance'});assert.equal(s.entries[1].status,'deferred');assert.equal(eligible(s).length,0);
 adminAction(s,{action:'session'});assert.equal(eligible(s).length,1);assert.equal(s.entries[0].status,'done');assert.equal(s.entries[1].status,'pending');
});
test('予約の名前修正も同じ回の重複を防ぐ',()=>{
 const s=state();const a=submit(s,{...input('A'),round:2},'a');submit(s,{...input('B'),round:2},'b');rename(s,a,'変更後');assert.throws(()=>rename(s,a,'B'),/応募/);assert.throws(()=>submit(s,{...input('A'),round:2},'c'),/リクエスト済み/);assert.equal(eligible(s).length,0);
});

test('同じ人が今と次の回に山P・その他を1曲ずつ、各枠だけ重複を拒否',()=>{
 const s=state();for(const round of [1,2]){submit(s,{...input('同じ人'),round,category:'yamapi'},'y'+round);submit(s,{...input('同じ人','曲','別歌手'),round,category:'other'},'o'+round);}
 assert.equal(s.entries.length,4);assert.equal(eligible(s,'yamapi').length,1);assert.equal(eligible(s,'other').length,1);
 assert.throws(()=>submit(s,{...input('同じ人','別曲','NEWS'),category:'yamapi'},'again'),/リクエスト済み/);
 assert.throws(()=>submit(s,{...input('別名'),category:'yamapi'},'y1'),/リクエスト済み/);
 assert.throws(()=>submit(s,{...input('別名'),category:'other'},'bad'),/枠/);
});
test('山P関連グループ・別名と旧データも同じ枠として扱う',()=>{
 const s=state();for(const artist of ['山下智久','やまぴー','NEWS','にゅーす','修二と彰','亀と山P']){const e=submit(s,input(artist,'曲',artist),artist);delete e.category;}
 assert.equal(eligible(s,'yamapi').length,6);assert.equal(eligible(s,'other').length,0);
 submit(s,input('同名','曲','別歌手'),'other');assert.equal(eligible(s,'other').length,1);
});
test('山P枠を処理し終えても他枠が残れば次の回に進まず抽選対象も混ざらない',()=>{
 const s=state();submit(s,input('A'),'y');submit(s,input('B','別曲','別歌手'),'o');submit(s,{...input('C','予約曲','別歌手'),round:2},'next');
 adminAction(s,{action:'advance',category:'yamapi'});assert.equal(s.current,s.entries[0].id);
 adminAction(s,{action:'advance',category:'yamapi'});assert.equal(s.round,1);assert.equal(s.entries[0].status,'done');assert.equal(s.entries[1].status,'pending');
 assert.throws(()=>adminAction(s,{action:'draw',category:'yamapi'}),/ありません/);assert.equal(s.round,1);
 adminAction(s,{action:'advance',category:'other'});assert.equal(s.current,s.entries[1].id);adminAction(s,{action:'advance',category:'other'});assert.equal(s.round,2);assert.equal(s.current,s.entries[2].id);
 adminAction(s,{action:'undo'});assert.equal(s.round,1);assert.equal(s.entries[1].status,'selected');assert.equal(s.entries[2].status,'pending');
});
test('両方の抽選は両カテゴリを対象にし不正な対象は拒否する',()=>{
 const s=state();submit(s,input('A'),'y');submit(s,input('B','別曲','別歌手'),'o');assert.equal(eligible(s).length,2);
 assert.throws(()=>adminAction(s,{action:'advance',category:'invalid'}),/抽選対象/);assert.equal(s.current,null);
 adminAction(s,{action:'advance',category:'all'});assert(s.entries.some(e=>e.id===s.current&&e.status==='selected'));
});
test('名前訂正と管理者の歌手変更でもカテゴリ別上限を守る',()=>{
 const s=state();const y=submit(s,input('A'),'y'),o=submit(s,input('A','曲','別歌手'),'o');rename(s,o,'訂正後');assert.throws(()=>submit(s,input('A','別曲','他歌手'),'o2'),/リクエスト済み/);
 assert.throws(()=>adminAction(s,{action:'edit',id:o.id,name:'A',artist:'NEWS',song:'曲'}),/応募済み/);
 rename(s,y,'訂正後');assert.equal(s.entries.length,2);
});
test('サーバーAPIでも同名の2枠を許可し、同じ枠の並行リクエストは1件だけ',async()=>{
 const e=env();const bodies=[{...input('A'),category:'yamapi'},{...input('A','別曲','別歌手'),category:'other'}];
 for(let i=0;i<2;i++)assert.equal((await worker.fetch(req('/api/requests',bodies[i],String(i).repeat(40)),e)).status,201);
 const results=await Promise.all(Array.from({length:4},(_,i)=>worker.fetch(req('/api/requests',{...input('B'),category:'yamapi'},String(i+3).repeat(40)),e)));assert.equal(results.filter(r=>r.status===201).length,1);
});

test('上部からの名前修正は本人の修正可能な枠だけを一括更新する', async () => {
  const e = env(), tokens = ['a', 'b', 'c'].map(value => value.repeat(40));
  for (const [i, data] of [input('A'), input('A', '曲', '別歌手'), input('別の人')].entries()) {
    assert.equal((await worker.fetch(req('/api/requests', data, tokens[i]), e)).status, 201);
  }
  const renameOwned = name => worker.fetch(new Request('https://requests.example/api/mine', {
    method:'PATCH', headers:{Origin:e.PUBLIC_ORIGIN, 'Content-Type':'application/json'},
    body:JSON.stringify({action:'renameAll', tokens:tokens.slice(0, 2), name})
  }), e);
  const names = () => Promise.all(tokens.map(async token => (await (await worker.fetch(req('/api/mine', undefined, token), e)).json()).entry.name));
  assert.equal((await renameOwned('別の人')).status, 409);
  assert.deepEqual(await names(), ['A', 'A', '別の人']);
  assert.equal((await renameOwned('訂正後')).status, 200);
  assert.deepEqual(await names(), ['訂正後', '訂正後', '別の人']);
});

test('本人は抽選前に同じ枠の曲を変更でき、選択後に届いた変更は拒否する', async () => {
  const e = env(), token = 'a'.repeat(40);
  const submitted = await (await worker.fetch(req('/api/requests', input('A'), token), e)).json();
  const edit = (artist, song, owner = token) => worker.fetch(new Request('https://requests.example/api/mine', {
    method:'PATCH', headers:{Origin:e.PUBLIC_ORIGIN, 'Content-Type':'application/json','X-Request-Token':owner},
    body:JSON.stringify({action:'editSong', artist, song})
  }), e);
  assert.equal((await edit('別歌手', '曲')).status, 400);
  assert.equal((await edit('山下智久', '指輪', 'b'.repeat(40))).status, 404);
  const result = await edit('山下智久','指輪');
  assert.equal(result.status, 200);
  const {entry} = await result.json();
  assert.equal(entry.id, submitted.entry.id);
  assert.equal(entry.song, '指輪');
  assert.equal(entry.name, 'A');
  const {mutate} = await import('../worker/index.mjs');
  await mutate(e, s => adminAction(s,{action:'advance'}));
  assert.equal((await edit('山下智久','別の曲')).status, 409);
  const after = await (await worker.fetch(req('/api/mine', undefined, token), e)).json();
  assert.equal(after.entry.song, '指輪');
  assert.equal(after.entry.songEditable, false);
});

test('当選したリクエストを理由なしで次回配信へ持ち越し、戻せる', () => {
 const s = state();
 const winner = submit(s, input('A'), 'a');
 submit(s, {...input('B','次の曲','歌手'),round:2}, 'b');
 adminAction(s, {action:'draw'});
 adminAction(s, {action:'defer', id:winner.id, selected:true});
 assert.equal(winner.status, 'deferred');
 assert.equal(winner.deferReason, 'manual');
 assert.equal(s.round, 2);
 assert.deepEqual(s.history, []);
 assert.deepEqual(s.unknown, {});
 adminAction(s, {action:'undo'});
 assert.equal(s.current, winner.id);
 assert.equal(winner.status, 'selected');
 assert.equal(s.round, 1);
 adminAction(s, {action:'defer', id:winner.id, selected:true});
 adminAction(s, {action:'session'});
 assert.equal(winner.status, 'pending');
 assert.equal(winner.deferReason, null);
 assert.ok(eligible(s).includes(winner));
});

test('管理一覧で次回へ送った曲を戻すと抽選待ちと受付回が復元される', () => {
 const s = state();
 const request = submit(s, input('A'), 'a');
 adminAction(s, { action:'defer', id:request.id });
 assert.equal(request.status, 'deferred');
 assert.equal(s.round, 2);
 adminAction(s, { action:'undo' });
 assert.equal(s.round, 1);
 assert.equal(request.status, 'pending');
 assert.equal(request.deferReason, null);
 assert.deepEqual(eligible(s), [request]);
});

test('停止時に当選曲を公開し、歌えない・次回歌うで消し、歌唱確定で二重に載せない', () => {
 const s = state();
 const entry = submit(s, input('非公開名'), 'a');
 adminAction(s, {action:'advance'});
 assert.deepEqual(publicState(s).played, []);
 const reveal = {action:'reveal', id:entry.id, drawnAt:entry.drawnAt};
 assert.throws(() => adminAction(s, {...reveal, drawnAt:entry.drawnAt - 1}), /当選曲が変わりました/);
 adminAction(s, reveal);
 const [shown] = publicState(s).played;
 assert.deepEqual(shown, {song:entry.song, artist:entry.artist, performedAt:entry.revealedAt});
 assert.deepEqual(s.history, []);
 adminAction(s, reveal);
 assert.deepEqual(publicState(s).played, [shown]);
 adminAction(s, {action:'defer', id:entry.id, selected:true});
 assert.deepEqual(publicState(s).played, []);
 adminAction(s, {action:'undo'});
 assert.deepEqual(publicState(s).played, [shown]);
 adminAction(s, {action:'cantSing', id:entry.id, reason:'no_audio'});
 assert.deepEqual(publicState(s).played, []);
 adminAction(s, {action:'undo'});
 adminAction(s, {action:'advance'});
 assert.deepEqual(publicState(s).played, [shown]);
 assert.equal(s.history.length, 1);
});

test('予約を繰り上げるときは同じ枠の曲を確認し、入れ替えと取り消しができる', () => {
 const s = state();
 const active = submit(s, input('A','現在の曲'), 'a');
 const next = submit(s, {...input('A','予約の曲'),round:2}, 'b');
 const action = {action:'bringForward',id:next.id};
 assert.throws(() => adminAction(s, action), error => error.code === 'request_slot_conflict' && error.details.id === active.id);
 assert.equal(active.status, 'pending');
 assert.equal(next.round, 2);
 adminAction(s, {...action,replaceId:active.id});
 assert.equal(active.status, 'removed');
 assert.deepEqual(eligible(s), [next]);
 adminAction(s, {action:'undo'});
 assert.equal(active.status, 'pending');
 assert.equal(next.round, 2);
});

test('一時保留は今日戻せて、手動選択して次の抽選なしで歌唱済みにできる', () => {
 const s = state();
 const first = submit(s, input('A'), 'a');
 const waiting = submit(s, input('B','別の曲'), 'b');
 adminAction(s, {action:'hold',id:first.id});
 assert.equal(first.deferReason, 'temporary');
 assert.equal(ownRequests(s,['a'])[0].deferReason, 'temporary');
 assert.deepEqual(eligible(s), [waiting]);
 adminAction(s, {action:'restoreRequest',id:first.id});
 adminAction(s, {action:'selectSong',id:first.id});
 assert.equal(s.current, first.id);
 assert.equal(first.manualPick, true);
 assert.throws(() => adminAction(s, {action:'selectSong',id:waiting.id}), /先に処理/);
 adminAction(s, {action:'done',id:first.id});
 assert.equal(first.status, 'done');
 assert.equal(waiting.status, 'pending');
 assert.deepEqual(eligible(s), [waiting]);
 assert.equal(publicState(s).played.length, 1);
});

test('歌えない理由の訂正と一件だけの復活を行い、歌えた時点で記録を解除する', () => {
 const s = state();
 const entry = submit(s, input('A'), 'a');
 const duplicate = submit(s, input('B'), 'b');
 adminAction(s, {action:'selectSong',id:entry.id});
 adminAction(s, {action:'cantSing',id:entry.id,reason:'no_audio'});
 const old = songStatus(s,entry.artist,entry.song);
 adminAction(s, {action:'correctReason',id:entry.id,reason:'unknown'});
 assert.equal(entry.status, 'deferred');
 assert.deepEqual(songStatus(s,entry.artist,entry.song).reasons, [{reason:'unknown',at:old.unknownAt}]);
 adminAction(s, {action:'undo'});
 assert.deepEqual(songStatus(s,entry.artist,entry.song), old);
 adminAction(s, {action:'restoreRequest',id:entry.id});
 assert.deepEqual(eligible(s), [entry]);
 assert.equal(duplicate.status, 'deferred');
 assert.deepEqual(songStatus(s,entry.artist,entry.song), old);
 adminAction(s, {action:'selectSong',id:entry.id});
 adminAction(s, {action:'done',id:entry.id});
 assert.equal(songStatus(s,entry.artist,entry.song).unknownAt, null);
});

test('再演を追加しても元の歌唱記録を保持し、誤登録だけを取り消せる', () => {
 const s = state();
 const original = submit(s, input('A'), 'a');
 adminAction(s, {action:'selectSong',id:original.id});
 adminAction(s, {action:'done',id:original.id});
 adminAction(s, {action:'encore',id:original.id});
 const [encore] = eligible(s);
 assert.equal(encore.encoreOf, original.id);
 assert.equal(publicState(s).played.length, 1);
 assert.equal(ownRequests(s,['a']).length, 1);
 adminAction(s, {action:'selectSong',id:encore.id});
 adminAction(s, {action:'done',id:encore.id});
 assert.equal(publicState(s).played.length, 2);
 adminAction(s, {action:'cancelPerformance',id:encore.id});
 assert.equal(publicState(s).played.length, 1);
 assert.equal(s.history[0].requestId, original.id);
 assert.deepEqual(eligible(s), [encore]);
 adminAction(s, {action:'undo'});
 assert.equal(publicState(s).played.length, 2);
});

test('旧形式の歌唱済みを取り消すと重複リクエストと元の曲が抽選に戻る', () => {
 const s = state();
 const a = submit(s, input('A'), 'a');
 const b = submit(s, input('B'), 'b');
 adminAction(s, {action:'selectSong',id:a.id});
 adminAction(s, {action:'done',id:a.id});
 delete s.history[0].requestId;
 delete s.history[0].songKey;
 adminAction(s, {action:'cancelPerformance',id:a.id});
 assert.deepEqual(publicState(s).played, []);
 assert.deepEqual(eligible(s), [a,b]);
 adminAction(s, {action:'undo'});
 assert.equal(publicState(s).played.length, 1);
 assert.deepEqual(eligible(s), []);
});

test('見送りと取り下げは個別に復活し、次回への持ち越しは一時保留と区別する', () => {
 const s = state();
 const a = submit(s, input('A','曲A'), 'a');
 const b = submit(s, input('B','曲B'), 'b');
 const c = submit(s, input('C','曲C'), 'c');
 adminAction(s, {action:'selectSong',id:a.id});
 adminAction(s, {action:'skip'});
 adminAction(s, {action:'remove',id:b.id});
 adminAction(s, {action:'defer',id:c.id});
 assert.equal(c.deferReason, 'manual');
 adminAction(s, {action:'restoreRequest',id:a.id});
 adminAction(s, {action:'restoreRequest',id:b.id});
 assert.deepEqual(eligible(s), [a,b]);
 assert.equal(c.status, 'deferred');
});

test('誤った歌唱済みを取り消すと歌えない記録が復元される', () => {
 const s = state();
 const entry = submit(s, input('A'), 'a');
 adminAction(s, {action:'selectSong',id:entry.id});
 adminAction(s, {action:'cantSing',id:entry.id,reason:'no_audio'});
 const unavailable = songStatus(s,entry.artist,entry.song);
 adminAction(s, {action:'restoreRequest',id:entry.id});
 adminAction(s, {action:'selectSong',id:entry.id});
 adminAction(s, {action:'done',id:entry.id});
 assert.equal(songStatus(s,entry.artist,entry.song).unknownAt, null);
 adminAction(s, {action:'cancelPerformance',id:entry.id});
 assert.deepEqual(songStatus(s,entry.artist,entry.song), unavailable);
 assert.equal(publicState(s).played.length, 0);
 assert.deepEqual(eligible(s), [entry]);
 adminAction(s, {action:'undo'});
 assert.equal(songStatus(s,entry.artist,entry.song).unknownAt, null);
 assert.equal(publicState(s).played.length, 1);
});

test('停止で当選曲を歌唱済みに確定し、二重登録せず抽選ごと戻せる', () => {
 const s = state();
 const entry = submit(s, input('A'), 'a');
 adminAction(s, {action:'advance'});
 const complete = {action:'completeDraw', id:entry.id, drawnAt:entry.drawnAt};
 assert.equal(entry.status, 'selected');
 adminAction(s, complete);
 assert.equal(entry.status, 'done');
 assert.equal(publicState(s).played.length, 1);
 adminAction(s, complete);
 assert.equal(s.history.length, 1);
 adminAction(s, {action:'undo'});
 assert.equal(entry.status, 'pending');
 assert.equal(s.current, null);
 assert.equal(s.round, 1);
 assert.equal(publicState(s).played.length, 0);
});

test('自動で歌唱済みになった当選曲を持ち越しや歌えないに変えられる', () => {
 const s = state();
 const entry = submit(s, input('A'), 'a');
 const next = submit(s, input('B','別の曲'), 'b');
 adminAction(s, {action:'selectSong',id:entry.id});
 adminAction(s, {action:'completeDraw',id:entry.id,drawnAt:entry.drawnAt});
 assert.throws(() => adminAction(s, {action:'cantSing',id:next.id,reason:'unknown'}), /当選曲が変わりました/);
 adminAction(s, {action:'defer',id:entry.id,selected:true});
 assert.equal(entry.deferReason, 'manual');
 assert.equal(publicState(s).played.length, 0);
 adminAction(s, {action:'undo'});
 assert.equal(entry.status, 'done');
 assert.equal(publicState(s).played.length, 1);
 adminAction(s, {action:'cantSing',id:entry.id,reason:'no_audio'});
 assert.equal(entry.deferReason, 'unknown');
 assert.equal(publicState(s).played.length, 0);
 assert.equal(songStatus(s,entry.artist,entry.song).reasons[0].reason, 'no_audio');
 assert.deepEqual(eligible(s), [next]);
});
