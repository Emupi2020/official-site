import { categoryOf } from './categories.mjs';
import { api, $, message, safeGet, safeSet } from './common.mjs';
import { setWheel, spin, settle } from './wheel.mjs?spin=natural-stop';
const categoryTabs = [...$('roulette-categories').querySelectorAll('button')];
const defaultCategory = 'yamapi';
const spinDuration = $('spin-duration');
const rouletteSettings = $('roulette-settings');
const previewSpin = $('preview-spin');
const spinDurationKey = 'emupi-request-spin-duration';
const savedDuration = safeGet(spinDurationKey);
if (spinDuration && [...spinDuration.options].some(option => option.value === savedDuration)) spinDuration.value = savedDuration;
spinDuration?.addEventListener('change', () => safeSet(spinDurationKey, spinDuration.value));
const spinTime = () => Number(spinDuration?.value || 5) * 1000;
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
const rowActions = node('div', '', 'request-row-menu');
rowActions.id = 'request-row-menu';
rowActions.setAttribute('popover', 'auto');
rowActions.setAttribute('role', 'group');
document.body.append(rowActions);
let rowActionsTrigger;

function requestActionsButton(entry) {
  const trigger = node('button', '…', 'request-row-menu-trigger');
  trigger.type = 'button';
  trigger.disabled = busy;
  trigger.setAttribute('aria-label', entry.song + 'の操作');
  trigger.setAttribute('popovertarget', rowActions.id);
  trigger.onclick = () => {
    if (rowActions.matches(':popover-open')) {
      if (rowActionsTrigger === trigger) return;
      rowActions.hidePopover();
    }
    rowActionsTrigger = trigger;
    ++refreshVersion;
    rowActions.setAttribute('aria-label', entry.song + 'の操作');
    rowActions.replaceChildren();
    function addChoice(label, handler, className) {
      const button = node('button', label, className);
      button.type = 'button';
      button.onclick = () => {
        rowActions.hidePopover();
        handler();
      };
      rowActions.append(button);
    }
    addChoice('修正', () => {
      const name = prompt('Pocochaの名前', entry.name);
      if (name === null) return;
      const artist = prompt('歌手名', entry.artist);
      if (artist === null) return;
      const song = prompt('曲名', entry.song);
      if (song !== null) action('edit', {id:entry.id, name, artist, song});
    });
    if (entry.status === 'pending') addChoice('次回へ', () => action('defer', {id:entry.id}));
    if (entry.status !== 'removed') addChoice('削除', () => {
      if (confirm('この応募を抽選対象から削除しますか？')) action('remove', {id:entry.id});
    }, 'danger');
    const bounds = trigger.getBoundingClientRect();
    const roomBelow = window.innerHeight - bounds.bottom;
    const openAbove = roomBelow < 44 * rowActions.children.length + 16 && bounds.top > roomBelow;
    rowActions.style.right = Math.max(8, window.innerWidth - bounds.right) + 'px';
    rowActions.style.top = openAbove ? 'auto' : bounds.bottom + 4 + 'px';
    rowActions.style.bottom = openAbove ? window.innerHeight - bounds.top + 4 + 'px' : 'auto';
  };
  return trigger;
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
function lock(value) {
  for (const button of document.querySelectorAll('#dashboard button, #roulette-screen button')) button.disabled = value;
  if (spinDuration) spinDuration.disabled = value;
}
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
  const selected = current?.status === 'selected';
  $('current-info').hidden = !selected && !state.undo && $('undo-feedback').hidden;
  $('current-song-details').hidden = !selected;
  $('undo').hidden = !selected && !state.undo;
  $('undo').disabled = busy || !state.undo;
  $('cant-sing').hidden = !selected;
  $('cant-sing').disabled = busy || !selected;
  if(!current){$('result-name').textContent='';$('selected-song').textContent='';}
  if(current){$('selected-song').textContent=`${current.song} ／ ${current.artist}`;$('result-song').textContent=current.song;$('result-artist').textContent=current.artist;$('result-name').textContent=`${current.name} さん`;}
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
    actionCell.append(requestActionsButton(e));
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
    if (animate) {
      const current = next.entries.find(entry => entry.id === next.current);
      if (current?.status === 'selected') {
        $('result').hidden = true;
        await spin(current.song, poolFor(next).map(entry => entry.song), spinTime());
        state = next;
        await api('/api/admin', {method:'POST', data:{action:'reveal', id:current.id, drawnAt:current.drawnAt}});
      }
    }
    state = next;
    render();
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
previewSpin?.addEventListener('click', async () => {
  if (busy || !state) return;
  const songs = poolFor(state).slice(0, 100).map(entry => entry.song);
  if (!songs.length) songs.push('サンプル曲 A', 'サンプル曲 B', 'サンプル曲 C', 'サンプル曲 D');
  const sample = songs.pop();
  busy = true;
  ++refreshVersion;
  lock(true);
  stageMessage('');
  previewSpin.textContent = 'プレビュー中';
  try {
    await spin(sample, songs, spinTime());
  } finally {
    busy = false;
    previewSpin.textContent = 'プレビュー';
    lock(false);
    render();
    if (rouletteSettings.open) previewSpin.focus();
  }
});
$('open-roulette').onclick = () => {
  if (rouletteSettings) rouletteSettings.open = false;
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
$('draw').onclick = () => {
  if (rouletteSettings) rouletteSettings.open = false;
  action('advance');
};
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
setInterval(()=>{if(!document.hidden&&!busy&&!rowActions.matches(':popover-open'))refresh().catch(error=>message(error.message,true));},10000);
