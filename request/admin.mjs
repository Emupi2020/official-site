import { categoryOf } from './categories.mjs';
import { api, $, message } from './common.mjs';
import { setWheel, spin, settle } from './wheel.mjs';
const categoryTabs = [...$('roulette-categories').querySelectorAll('button')];
const defaultCategory = 'yamapi';
let state, busy = false, dismissedResult = null, drawCategory = defaultCategory;
let refreshVersion = 0;
const resultKey = entry => entry ? `${entry.id}:${entry.drawnAt}:${entry.status}` : null;
function stageMessage(value){$('roulette-message').hidden=!value;$('roulette-message').textContent=value;}
function node(tag, text, className) { const e=document.createElement(tag); e.textContent=text;if(className)e.className=className;return e; }
function undoFeedback(text, error = false) {
  const feedback = $('undo-feedback');
  feedback.textContent = text;
  feedback.hidden = !text;
  feedback.classList.toggle('danger', error);
}
async function action(action, extra = {}) {
  if (busy) return;
  busy = true;
  ++refreshVersion;
  lock(true);
  message('');
  stageMessage('');
  undoFeedback('');
  $('roulette-screen').classList.add('spinning');
  const drawing = ['draw', 'advance'].includes(action);
  try {
    await api('/api/admin', {method:'POST', data:{action, ...extra, ...(drawing ? {category:drawCategory} : {})}});
    await refresh(drawing);
    if (action === 'undo' && state) undoFeedback('直前の操作を取り消しました。');
  } catch (error) {
    if (action === 'undo') undoFeedback(error.message, true);
    else { message(error.message, true); stageMessage(error.message); }
  } finally {
    busy = false;
    $('roulette-screen').classList.remove('spinning');
    lock(false);
    render();
    if ($('roulette-screen').open && !$('result').hidden) $('dismiss-result').focus();
  }
}
function lock(value){for(const b of document.querySelectorAll('#dashboard button, #roulette-screen button'))b.disabled=value;}
const poolFor = ({ entries, round }) => entries.filter(entry =>
  entry.status === 'pending' && entry.round <= round && (drawCategory === 'all' || categoryOf(entry) === drawCategory)
);
function render() {
  if(!state)return;
  $('round').textContent=`第${state.round}回`;$('status').textContent='受付中';
  const pending=state.entries.filter(e=>e.status==='pending'&&e.round<=state.round).length, deferred=state.entries.filter(e=>e.status==='deferred').length;
  const reserved=state.entries.filter(e=>e.round===state.round+1&&!['done','removed','skipped'].includes(e.status)).length;
  $('counts').textContent=`残り ${pending}件 · 次の回の予約 ${reserved}件 · 次回配信へ ${deferred}件`;
  const current=state.entries.find(e=>e.id===state.current);
  renderRoulette(current);
  $('undo').disabled=busy||!state.undo;
  $('cant-sing').disabled=busy||current?.status!=='selected';
  $('current-info').hidden=!current;
  if(!current){$('result-name').textContent='';$('selected-song').textContent='';}
  if(current){$('selected-song').textContent=`${current.song} ／ ${current.artist}`;$('result-song').textContent=current.song;$('result-artist').textContent=current.artist;$('result-name').textContent=`${current.name} さん${current.status==='deferred'?' · 次回へ保留':''}`;}
  if(current?.status!=='selected')$('cant-sing-dialog').close('cancel');
  const tables = { yamapi: $('entries-yamapi'), other: $('entries-other') };
  const processed = $('entries-processed');
  processed?.replaceChildren();
  for (const table of Object.values(tables)) table.replaceChildren();
  for(const e of [...state.entries].reverse()){
    const row=node('tr','','request-row'), songCell=node('td'),nameCell=node('td',e.name),statusCell=node('td'),actionCell=node('td');
    songCell.append(node('div',e.song,'entry-title'),node('div',e.artist,'small muted'));
    statusCell.append(node('span',({pending:'抽選待ち',selected:'選択中',done:'歌唱済み',deferred:'次回へ',skipped:'見送り',removed:'取り下げ'})[e.status]||e.status,'entry-status'),node('div',`第${e.round}回`,'small muted'));
    if(e.round>state.round)statusCell.prepend(node('div','予約','entry-status'));
    row.append(songCell,nameCell,statusCell,actionCell);
    const record=state.unknown?.[e.songKey];
    if(record){const reasons=record.reasons||{unknown:record.at};songCell.append(node('p',Object.entries(reasons).map(([reason,at])=>`${reason==='no_audio'?'音源なし':'知らない'} · ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(at)}`).join(' ／ '),'small muted'));}
    const buttons=node('div','','buttons');
    const edit=node('button','修正','secondary');edit.disabled=busy;edit.onclick=()=>{
      const name=prompt('Pocochaの名前',e.name);if(name===null)return;
      const artist=prompt('歌手名',e.artist);if(artist===null)return;
      const song=prompt('曲名',e.song);if(song===null)return;action('edit',{id:e.id,name,artist,song});
    };buttons.append(edit);
    if(e.status==='pending'){const defer=node('button','次回へ','secondary');defer.disabled=busy;defer.onclick=()=>action('defer',{id:e.id});buttons.append(defer);}
    if(e.status!=='removed'){const remove=node('button','削除','secondary danger');remove.disabled=busy;remove.onclick=()=>{if(confirm('この応募を抽選対象から削除しますか？'))action('remove',{id:e.id});};buttons.append(remove);}actionCell.append(buttons);
    const active = e.status === 'pending' || e.status === 'selected';
    const table = !active && processed ? processed : tables[categoryOf(e)];
    table.append(row);
  }
  if (processed) $('processed-requests').hidden = !processed.rows.length;
  for (const table of Object.values(tables)) {
    if (table.rows.length) continue;
    const row = node('tr'), cell = node('td', '抽選待ち・選択中のリクエストはありません。', 'empty-requests');
    cell.colSpan = 4;
    row.append(cell);
    table.append(row);
  }
  const suggestions=$('suggestions');suggestions.replaceChildren();
  for(const item of state.suggestions){const row=node('div','','entry row');row.append(node('span',`${item.song} ／ ${item.artist}`,'small'));const remove=node('button','削除','text-button');remove.disabled=busy;remove.onclick=()=>action('removeSuggestion',{id:item.id});row.append(remove);suggestions.append(row);}
  if(!state.suggestions.length)suggestions.append(node('p','新しい入力候補はまだありません。','small muted'));
}
function renderRoulette(current = state.entries.find(entry => entry.id === state.current)) {
  const songs = poolFor(state).map(entry => entry.song);
  const selected = current?.status === 'selected';
  const result = $('result');
  const wasHidden = result.hidden;
  result.hidden = !$('roulette-screen').open || !selected || dismissedResult === resultKey(current);
  document.querySelector('.broadcast-wheel').inert = !result.hidden;
  $('close-roulette').hidden = !result.hidden;
  $('draw').setAttribute('aria-label', current ? '次を回す' : '回す');
  $('draw').disabled = busy || (!songs.length && !selected);
  for (const tab of categoryTabs) {
    tab.setAttribute('aria-pressed', String(tab.value === drawCategory));
  }
  if (!busy) {
    if (result.hidden) setWheel(songs);
    else settle(current.song, songs);
  }
  if (wasHidden && !result.hidden) $('dismiss-result').focus();
}
async function refresh(animate=false){
  const version = ++refreshVersion;
  try{
    const next = await api('/api/admin');
    if (version !== refreshVersion) return;
    $('login').hidden=true;$('dashboard').hidden=false;
    if(animate){const current=next.entries.find(e=>e.id===next.current);if(current?.status==='selected'){$('result').hidden=true;await spin(current.song,[...poolFor(next), current].map(e=>e.song));}}
    state=next;render();
  }catch(error){if(version!==refreshVersion)return;if(error.status===401){$('login').hidden=false;$('dashboard').hidden=true;$('roulette-screen').close();state=null;}else throw error;}
}
$('login-form').onsubmit=async event=>{
  event.preventDefault();$('login-submit').disabled=true;message('');
  try{await api('/auth/login',{method:'POST',data:{password:$('password').value}});$('password').value='';await refresh();}
  catch(error){message(error.message,true);}finally{$('login-submit').disabled=false;}
};
for (const tab of categoryTabs) {
  tab.onclick = () => {
    drawCategory = tab.value;
    stageMessage('');
    renderRoulette();
  };
}
$('open-roulette').onclick = () => {
  drawCategory = defaultCategory;
  dismissedResult = null;
  $('roulette-screen').showModal();
  document.body.classList.add('roulette-open');
  renderRoulette();
  if ($('result').hidden) categoryTabs.find(tab => tab.value === drawCategory).focus();
};
$('close-roulette').onclick=()=>{if(!busy)$('roulette-screen').close();};
$('roulette-screen').addEventListener('close',()=>{document.body.classList.remove('roulette-open');$('open-roulette').focus();});
$('roulette-screen').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('dismiss-result').onclick = () => {
  dismissedResult = resultKey(state.entries.find(entry => entry.id === state.current));
  renderRoulette();
  $('draw').focus();
};
$('draw').onclick = () => action('advance');
async function resolveWinner(operation, extra) {
  await action(operation, extra);
  if (!$('roulette-screen').open || !$('result').hidden) return;
  const control = $('draw').disabled ? categoryTabs.find(tab => tab.value === drawCategory) : $('draw');
  control.focus();
}
async function cantSing() {
  const id = state.current;
  const dialog = $('cant-sing-dialog');
  dialog.returnValue = '';
  const reason = await new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
  if (['unknown', 'no_audio'].includes(reason)) await resolveWinner('cantSing', { id, reason });
}
$('cant-sing').onclick = cantSing;
$('result-cant-sing').onclick = cantSing;
$('result-defer').onclick = () => resolveWinner('defer', { id:state.current, selected:true });
$('undo').onclick=()=>action('undo');
$('next-session').onclick=()=>{if(confirm('次回配信を開始しますか？歌唱履歴を区切り、保留していた応募を抽選に戻します。'))action('session');};
$('logout').onclick=async()=>{await fetch('/auth/logout',{method:'POST'});location.reload();};
try{await refresh();}catch(error){message(error.message,true);}
setInterval(()=>{if(!document.hidden&&!busy)refresh().catch(error=>message(error.message,true));},10000);
