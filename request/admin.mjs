import { api, $, message, statusText } from './common.mjs';
import { setWheel, spin, settle } from './wheel.mjs';
let state, busy = false;
function node(tag, text, className) { const e=document.createElement(tag); e.textContent=text;if(className)e.className=className;return e; }
async function action(action, extra={}) {
  if(busy)return;busy=true;lock(true);message('');
  try { await api('/api/admin',{method:'POST',data:{action,...extra}});await refresh(action==='draw'||action==='advance'); }
  catch(error){message(error.message,true);}finally{busy=false;lock(false);render();}
}
function lock(value){for(const b of document.querySelectorAll('#dashboard button'))b.disabled=value;}
function render() {
  if(!state)return;
  $('round').textContent=`第${state.round}回`;$('status').textContent=state.open?'受付中':'受付終了';$('toggle').textContent=state.open?'受付を締める':'受付を開く';
  const pending=state.entries.filter(e=>e.status==='pending').length, deferred=state.entries.filter(e=>e.status==='deferred').length;
  $('counts').textContent=`残り ${pending}件 · 次回 ${deferred}件`;
  const current=state.entries.find(e=>e.id===state.current);
  $('draw').textContent=current?'次を回す':'回す';
  $('draw').disabled=busy || (!pending && current?.status!=='selected');$('undo').disabled=busy||!state.undo;
  $('cant-sing').disabled=busy||current?.status!=='selected';
  $('result').hidden=!current;
  if(current){$('result-song').textContent=current.song;$('result-artist').textContent=current.artist;$('result-name').textContent=`${current.name} さん${current.status==='deferred'?' · 次回へ保留':''}`;}
  if(current?.status!=='selected')$('cant-sing-dialog').close('cancel');
  if(!busy){const songs=state.entries.filter(e=>e.status==='pending').map(e=>e.song);if(current)settle(current.song,songs);else setWheel(songs);}
  const entries=$('entries');entries.replaceChildren();
  for(const e of [...state.entries].reverse()){
    const row=node('div','','entry');row.append(node('div',`${e.song} ／ ${e.artist}`,'entry-title'),node('p',`${e.name} · 第${e.round}回 · ${statusText[e.status]}`,'small muted'));
    const record=state.unknown?.[e.songKey];
    if(record){const reasons=record.reasons||{unknown:record.at};row.append(node('p',Object.entries(reasons).map(([reason,at])=>`${reason==='no_audio'?'音源なし':'知らない'} · ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(at)}`).join(' ／ '),'small muted'));}
    const buttons=node('div','','buttons');
    const edit=node('button','修正','secondary');edit.disabled=busy;edit.onclick=()=>{
      const name=prompt('Pocochaの名前',e.name);if(name===null)return;
      const artist=prompt('歌手名',e.artist);if(artist===null)return;
      const song=prompt('曲名',e.song);if(song===null)return;action('edit',{id:e.id,name,artist,song});
    };buttons.append(edit);
    if(e.status==='pending'){const defer=node('button','次回へ','secondary');defer.disabled=busy;defer.onclick=()=>action('defer',{id:e.id});buttons.append(defer);}
    if(e.status!=='removed'){const remove=node('button','削除','secondary danger');remove.disabled=busy;remove.onclick=()=>{if(confirm('この応募を抽選対象から削除しますか？'))action('remove',{id:e.id});};buttons.append(remove);}row.append(buttons);entries.append(row);
  }
  if(!state.entries.length)entries.append(node('p','まだ応募はありません。','muted'));
  const suggestions=$('suggestions');suggestions.replaceChildren();
  for(const item of state.suggestions){const row=node('div','','entry row');row.append(node('span',`${item.song} ／ ${item.artist}`,'small'));const remove=node('button','削除','text-button');remove.disabled=busy;remove.onclick=()=>action('removeSuggestion',{id:item.id});row.append(remove);suggestions.append(row);}
  if(!state.suggestions.length)suggestions.append(node('p','新しい入力候補はまだありません。','small muted'));
}
async function refresh(animate=false){
  try{
    const next=await api('/api/admin');$('login').hidden=true;$('dashboard').hidden=false;
    if(animate){const current=next.entries.find(e=>e.id===next.current);if(current?.status==='selected'){$('result').hidden=true;await spin(current.song,next.entries.filter(e=>e.status==='pending'||e.id===current.id).map(e=>e.song));}}
    state=next;render();
  }catch(error){if(error.status===401){$('login').hidden=false;$('dashboard').hidden=true;state=null;}else throw error;}
}
$('toggle').onclick=()=>action(state.open?'close':'open');$('draw').onclick=()=>action('advance');$('cant-sing').onclick=async()=>{
  const dialog=$('cant-sing-dialog');dialog.returnValue='';
  const reason=await new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true});dialog.showModal();});
  if(['unknown','no_audio'].includes(reason))await action('cantSing',{reason});
};$('undo').onclick=()=>action('undo');
$('next-round').onclick=()=>{if(confirm('次の受付回に切り替えますか？全員が再応募できるようになります。未消化・保留の応募は残ります。'))action('round');};
$('next-session').onclick=()=>{if(confirm('次回配信を開始しますか？歌唱履歴を区切り、保留していた応募を抽選に戻します。'))action('session');};
$('logout').onclick=async()=>{await fetch('/auth/logout',{method:'POST'});location.reload();};
try{await refresh();}catch(error){message(error.message,true);}
setInterval(()=>{if(!document.hidden&&!busy)refresh().catch(error=>message(error.message,true));},10000);
