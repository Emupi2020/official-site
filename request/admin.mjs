import { categoryOf } from './categories.mjs';
import { api, $, message, safeGet, safeSet } from './common.mjs?admin=request-exceptions';
import { setWheel, spin, settle } from './wheel.mjs?spin=natural-stop';
import { prepareRouletteSound, startDrumRoll, playWinnerSound } from './roulette-sound.mjs?audio=stronger-cymbal';
const categoryTabs = [...$('roulette-categories').querySelectorAll('button')];
const defaultCategory = 'yamapi';
const adminMenu = $('admin-menu');
if (adminMenu) {
  document.addEventListener('click', event => {
    if (adminMenu.open && !adminMenu.contains(event.target)) adminMenu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !adminMenu.open) return;
    adminMenu.open = false;
    adminMenu.querySelector('summary').focus();
  });
  adminMenu.addEventListener('toggle', () => {
    if (!adminMenu.open) for (const section of adminMenu.querySelectorAll('details[open]')) section.open = false;
  });
}
const spinDuration = $('spin-duration');
const rouletteSettings = $('roulette-settings');
const previewSpin = $('preview-spin');
const spinDurationKey = 'emupi-request-spin-duration';
const savedDuration = safeGet(spinDurationKey);
if (spinDuration && [...spinDuration.options].some(option => option.value === savedDuration)) spinDuration.value = savedDuration;
spinDuration?.addEventListener('change', () => safeSet(spinDurationKey, spinDuration.value));
const spinTime = () => Number(spinDuration?.value || 5) * 1000;
const winnerSound = $('winner-sound');
const soundKey = 'emupi-roulette-winner-sound';
const savedSound = safeGet(soundKey);
if ([...winnerSound.options].some(option => option.value === savedSound)) winnerSound.value = savedSound;
winnerSound.onchange = () => safeSet(soundKey, winnerSound.value);
function prepareSpinAudio() {
  if (winnerSound.value !== 'off') return prepareRouletteSound();
}
async function spinWithAudio(song, songs, audioReady) {
  const duration = spinTime();
  const start = performance.now();
  let buffers, stopRoll;
  let spinning = true;
  void audioReady?.then(loaded => {
    buffers = loaded;
    const remaining = duration - (performance.now() - start);
    if (spinning && loaded && remaining > 100 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stopRoll = startDrumRoll(loaded, remaining);
    }
  });
  try {
    await spin(song, songs, duration);
    return buffers;
  } finally {
    spinning = false;
    stopRoll?.();
  }
}
let state, busy = false, dismissedResult = null, drawCategory = defaultCategory;
let refreshVersion = 0;
const hasWinner = entry => entry?.status === 'selected' || (entry?.status === 'done' && Boolean(entry.autoDone));
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

function editRequest(entry) {
  const name = prompt('Pocochaの名前', entry.name);
  if (name === null) return;
  const artist = prompt('歌手名', entry.artist);
  if (artist === null) return;
  const song = prompt('曲名', entry.song);
  if (song !== null) action('edit', {id:entry.id, name, artist, song});
}
function correctReason(entry, previous) {
  const dialog = $('correct-reason-dialog');
  dialog.returnValue = '';
  for (const choice of dialog.querySelectorAll('button')) choice.disabled = choice.value === previous;
  dialog.addEventListener('close', () => {
    if (['unknown','no_audio'].includes(dialog.returnValue)) action('correctReason', {id:entry.id, reason:dialog.returnValue});
  }, {once:true});
  dialog.showModal();
}
function queueChoices(entry) {
  const command = (label, operation, confirmation) => ({ label, handler:() => {
    if (!confirmation || confirm(confirmation)) action(operation, {id:entry.id});
  } });
  if (entry.status === 'pending') {
    const choices = [{label:'リクエストを変更', handler:() => editRequest(entry)}];
    if (entry.round > state.round) choices.push(command('今回の抽選に入れる', 'bringForward'));
    else choices.push(command('今回だけ一時保留', 'hold'));
    choices.push(command('次回配信へ持ち越す', 'defer'));
    if (entry.round <= state.round && !state.entries.some(item => item.id === state.current && item.status === 'selected')) {
      choices.push(command('この曲を手動で選ぶ', 'selectSong', 'ルーレットを回さず、この曲を選びますか？'));
    }
    choices.push({...command('取り下げる', 'remove', 'このリクエストを取り下げますか？'), className:'danger'});
    return choices;
  }
  if (entry.status === 'done') return [
    command('歌唱済みを取り消す', 'cancelPerformance', '歌唱済み一覧からこの記録を外し、今回の抽選に戻しますか？'),
    command('再演用に抽選へ追加', 'encore', '歌唱済みの記録を残して、もう一度抽選に入れますか？'),
  ];
  if (['skipped','removed'].includes(entry.status)) return [command('リクエストを復活', 'restoreRequest')];
  if (entry.status !== 'deferred') return [];
  const repeat = entry.deferReason === 'sung';
  const choices = [command('今回の抽選に戻す', 'restoreRequest', repeat ? '今回すでに歌った曲です。もう一度抽選に入れますか？' : undefined)];
  const record = state.unknown?.[entry.songKey];
  if (entry.deferReason === 'unknown' && record) {
    const reasons = Object.keys(record.reasons || {unknown:record.at});
    const previous = entry.unavailableReason || (reasons.length === 1 ? reasons[0] : null);
    if ($('correct-reason-dialog') && previous && reasons.includes(previous) && (!entry.unavailableAt || entry.unavailableAt === record.reasons?.[previous])) choices.push({label:'歌えない理由を訂正', handler:() => correctReason(entry, previous)});
  }
  return choices;
}
function rowChoices(entry) {
  return [...queueChoices(entry), {
    label:'リクエストを初期化',
    className:'danger',
    handler:() => {
      if (!confirm(`${entry.name}さんの「${entry.song}」のリクエストを初期化しますか？\n今の募集・予約の枠なら、リスナーは送り直せます。歌唱済みの記録は残ります。`)) return;
      const {name, artist, song, status} = entry;
      action('resetRequest', {id:entry.id, expected:{name, artist, song, status}});
    }
  }];
}
function requestActionsButton(entry, choices) {
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
    for (const {label, handler, className} of choices) {
      const button = node('button', label, className);
      button.type = 'button';
      button.onclick = () => {
        rowActions.hidePopover();
        handler();
      };
      rowActions.append(button);
    }
    const bounds = trigger.getBoundingClientRect();
    const roomBelow = window.innerHeight - bounds.bottom;
    const openAbove = roomBelow < 44 * rowActions.children.length + 16 && bounds.top > roomBelow;
    rowActions.style.maxHeight = Math.max(44, (openAbove ? bounds.top : roomBelow) - 12) + 'px';
    rowActions.style.right = Math.max(8, window.innerWidth - bounds.right) + 'px';
    rowActions.style.top = openAbove ? 'auto' : bounds.bottom + 4 + 'px';
    rowActions.style.bottom = openAbove ? window.innerHeight - bounds.top + 4 + 'px' : 'auto';
  };
  return trigger;
}

async function postAdminAction(data) {
  const post = input => api('/api/admin', {method:'POST', data:input});
  try {
    await post(data);
  } catch (error) {
    if (error.code !== 'request_slot_conflict' || !error.details) throw error;
    if (!confirm('今回の同じ枠に「' + error.details.song + '」があります。この曲を取り下げて、選んだ曲と入れ替えますか？')) return false;
    await post({ ...data, replaceId:error.details.id });
  }
  return true;
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
  const audioReady = drawing ? prepareSpinAudio() : undefined;
  try {
    if (!await postAdminAction({action, ...extra, ...(drawing ? {category:drawCategory} : {})})) return;
    await refresh(drawing, action === 'selectSong', audioReady);
    if (action === 'undo' && state) undoFeedback('直前の操作を取り消しました。');
    if (action === 'resetRequest') message('リクエストを初期化しました。');
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
  for (const button of document.querySelectorAll('#dashboard button, #roulette-screen button, #admin-menu button')) button.disabled = value;
  if (spinDuration) spinDuration.disabled = value;
  winnerSound.disabled = value;
}
const poolFor = ({ entries, round, sung = [], held = [] }) => entries.filter(entry =>
  entry.status === 'pending' && entry.round <= round && (drawCategory === 'all' || categoryOf(entry) === drawCategory)
    && (!sung.includes(entry.songKey) || entry.allowRepeat) && (!held.includes(entry.songKey) || entry.retryHeld)
);
function render() {
  if(!state)return;
  $('round').textContent=`第${state.round}回`;$('status').textContent='受付中';
  const pending=state.entries.filter(e=>e.status==='pending'&&e.round<=state.round).length;
  const deferred=state.entries.filter(e=>e.status==='deferred'&&e.deferReason!=='temporary').length;
  const held=state.entries.filter(e=>e.status==='deferred'&&e.deferReason==='temporary').length;
  const reserved=state.entries.filter(e=>e.round===state.round+1&&!['done','removed','skipped'].includes(e.status)).length;
  $('counts').textContent=`残り ${pending}件 · 次の回の予約 ${reserved}件 · 次回配信へ ${deferred}件${held ? ' · 一時保留 '+held+'件' : ''}`;
  const current=state.entries.find(e=>e.id===state.current);
  renderRoulette(current);
  const selected = hasWinner(current);
  $('current-info').hidden = !selected && !state.undo && $('undo-feedback').hidden;
  $('current-song-details').hidden = !selected;
  $('undo').hidden = !selected && !state.undo;
  $('undo').disabled = busy || !state.undo;
  $('cant-sing').hidden = !selected;
  $('cant-sing').disabled = busy || !selected;
  const currentLabel = $('current-song-label');
  if (currentLabel) currentLabel.textContent = current?.manualPick ? '手動選択中の曲' : '当選中の曲';
  if(!current){$('result-name').textContent='';$('selected-song').textContent='';$('selected-artist').textContent='';}
  if(current){$('selected-song').textContent=current.song;$('selected-artist').textContent=current.artist;$('result-song').textContent=current.song;$('result-artist').textContent=current.artist;$('result-name').textContent=`${current.name} さん`;}
  if(!selected)$('cant-sing-dialog').close('cancel');
  const tables = { yamapi: $('entries-yamapi'), other: $('entries-other') };
  const processed = $('entries-processed');
  processed?.replaceChildren();
  for (const table of Object.values(tables)) table.replaceChildren();
  for(const e of [...state.entries].reverse()){
    const row=node('tr','','request-row'), songCell=node('td'),nameCell=node('td',e.name),statusCell=node('td'),actionCell=node('td');
    songCell.append(node('div',e.song,'entry-title'),node('div',e.artist,'small muted'));
    statusCell.append(node('span',({pending:'抽選待ち',selected:'選択中',done:'歌唱済み',deferred:e.deferReason==='temporary'?'一時保留':'次回へ',skipped:'見送り',removed:'取り下げ'})[e.status]||e.status,'entry-status'),node('div',`第${e.round}回`,'small muted'));
    if(e.round>state.round)statusCell.prepend(node('div','予約','entry-status'));
    if(e.encoreOf)statusCell.prepend(node('div','再演用','entry-status'));
    row.append(songCell,nameCell,statusCell,actionCell);
    const record=state.unknown?.[e.songKey];
    if(record){const reasons=record.reasons||{unknown:record.at};songCell.append(node('p',Object.entries(reasons).map(([reason,at])=>`${reason==='no_audio'?'音源なし':'知らない'} · ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(at)}`).join(' ／ '),'small muted'));}
    const choices = rowChoices(e);
    if (choices.length) actionCell.append(requestActionsButton(e, choices));
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
  for(const item of state.suggestions){const row=node('div','','entry row');const identity=node('div');identity.append(node('div',item.song,'entry-title'),node('div',item.artist,'small muted'));row.append(identity);const remove=node('button','削除','text-button');remove.disabled=busy;remove.onclick=()=>action('removeSuggestion',{id:item.id});row.append(remove);suggestions.append(row);}
  if(!state.suggestions.length)suggestions.append(node('p','新しい入力候補はまだありません。','small muted'));
}
function renderRoulette(current = state.entries.find(entry => entry.id === state.current)) {
  const songs = poolFor(state).map(entry => entry.song);
  const selected = current?.status === 'selected';
  const result = $('result');
  const wasHidden = result.hidden;
  result.hidden = !$('roulette-screen').open || !hasWinner(current) || dismissedResult === resultKey(current);
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
async function refresh(animate = false, manual = false, audioReady) {
  const version = ++refreshVersion;
  try{
    let next = await api('/api/admin');
    if (version !== refreshVersion) return;
    $('login').hidden=true;$('dashboard').hidden=false;
    if (adminMenu) adminMenu.hidden = false;
    const current = next.entries.find(entry => entry.id === next.current);
    const animatedWinner = animate && current?.status === 'selected';
    let buffers;
    if (current?.status === 'selected' && (animate || manual || current.revealedAt)) {
      if (animate) {
        $('result').hidden = true;
        buffers = await spinWithAudio(current.song, poolFor(next).map(entry => entry.song), audioReady);
      }
      if (version !== refreshVersion) return;
      state = next;
      const data = {action:'completeDraw', id:current.id, drawnAt:current.drawnAt};
      await api('/api/admin', {method:'POST', data});
      next = await api('/api/admin');
      if (version !== refreshVersion) return;
    }
    state = next;
    render();
    if (animatedWinner && !$('result').hidden) playWinnerSound(winnerSound.value, buffers);
  }catch(error){if(version!==refreshVersion)return;if(error.status===401){$('login').hidden=false;$('dashboard').hidden=true;if(adminMenu){adminMenu.open=false;adminMenu.hidden=true;}$('roulette-screen').close();state=null;}else throw error;}
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
  const audioReady = prepareSpinAudio();
  try {
    const buffers = await spinWithAudio(sample, songs, audioReady);
    playWinnerSound(winnerSound.value, buffers);
  } finally {
    busy = false;
    previewSpin.textContent = 'プレビュー';
    lock(false);
    render();
    if (rouletteSettings.open) previewSpin.focus();
  }
});
$('open-roulette').onclick = () => {
  void prepareSpinAudio();
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
