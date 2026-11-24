import { classifyArtist, categoryLabel } from './categories.mjs';
import { api, $, message, safeGet, safeSet, normalize, statusText } from './common.mjs';
let state, items=[], tokens, busy=false, nameEditing=false;
try { tokens=JSON.parse(safeGet('emupi-request-tokens')||'{}'); } catch { tokens={}; }
const duplicateStorageKey = 'emupi-duplicate-requests';
let confirmedDuplicates = [];
try {
 const saved = JSON.parse(safeGet(duplicateStorageKey) || '[]');
 if (Array.isArray(saved)) confirmedDuplicates = saved;
} catch {}
const duplicateKey = (round, category, name) => JSON.stringify([round, category, name.normalize('NFKC').trim().replace(/s+/g, ' ').toLowerCase()]);
function renderDuplicateSlots() {
 if (!state) return;
 for (const slot of slots) {
  const duplicate = !slot.entry && confirmedDuplicates.includes(duplicateKey(slot.round, slot.category, $('name').value));
  part(slot, '.slot-duplicate').hidden = !duplicate;
  part(slot, '.slot-form').hidden = duplicate || (!!slot.entry && !slot.editing);
 }
 for (const category of ['yamapi', 'other']) {
  const current = slots.find(slot => slot.category === category && !slot.reserved);
  const next = slots.find(slot => slot.category === category && slot.reserved);
  $('reserve-' + category).hidden = !current.entry && !next.entry && part(current, '.slot-duplicate').hidden;
 }
}
const slots=[...document.querySelectorAll('.request-slot')].map(root=>({root,id:root.id,category:root.dataset.category,reserved:root.dataset.reserved==='true',entry:null,token:null,round:null,draftRound:null}));
const field=(slot,name)=>$(`${slot.id}-${name}`);
const part=(slot,selector)=>slot.root.querySelector(selector);
$('name').value=safeGet('emupi-request-name')||'';
function tokenFor(round,category){const key=`${round}:${category}`;if(!tokens[key]){tokens[key]=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');safeSet('emupi-request-tokens',JSON.stringify(tokens));}return tokens[key];}
function canSubmit(slot) {
 const fields = [field(slot, 'artist'), field(slot, 'song')];
 if (!slot.editing) fields.push($('name'));
 return !!state && !busy && !nameEditing && fields.every(input => input.value.trim() && input.validity.valid);
}
function lock(value) {
 busy = value;
 for (const button of document.querySelectorAll('.slot-cancel, .slot-edit, #save-name, #edit-name, #cancel-name')) button.disabled = busy;
 for (const slot of slots) part(slot, '.slot-submit').disabled = !canSubmit(slot);
}
function feedback(slot, text, error = true) {
 const box = part(slot, '.slot-feedback');
 const container = slot.editing || !slot.entry ? part(slot, '.input-group') : part(slot, '.slot-receipt');
 const actions = container.querySelector('.edit-actions');
 container.insertBefore(box, actions);
 box.textContent = text;
 box.hidden = !text;
 box.classList.toggle('error', error);
}
function historyRow(list,song,artist,status){const row=document.createElement('li'),title=document.createElement('div'),subtitle=document.createElement('div'),label=document.createElement('span');title.textContent=song;title.className='history-song';subtitle.textContent=artist;subtitle.className='history-artist';label.textContent=status;label.className='history-status';row.append(title,subtitle,label);list.append(row);}
function renderHistory(myRequests){
 $('my-history').hidden=!myRequests.length;$('my-history-count').textContent=myRequests.length?`${myRequests.length}件`:'';$('my-history-list').replaceChildren();
 const labels={pending:'抽選待ち',selected:'選択中',done:'歌唱済み',deferred:'次回へ保留',skipped:'見送り',removed:'取り下げ'};
 for(const entry of [...myRequests].reverse())historyRow($('my-history-list'),entry.song,entry.artist,`${categoryLabel(entry.category)} · ${entry.round>state.round?'次回の予約 · ':entry.round===state.round?'今回 · ':'過去のリクエスト · '}${labels[entry.status]||entry.status}${entry.status!=='done'&&entry.playedThisSession?' · 同じ曲は今回歌唱済み':''}`);
 const played=state.played||[];$('played-count').textContent=played.length?`${played.length}曲`:'';$('played-empty').hidden=!!played.length;$('played-list').replaceChildren();
 for(const entry of [...played].reverse())historyRow($('played-list'),entry.song,entry.artist,entry.performedAt?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(entry.performedAt):'歌唱済み');
}
async function refresh(){
 const next=await api('/api/state');
 const keys=[...new Set(slots.map(slot=>{const round=next.round+Number(slot.reserved);return tokens[`${round}:${slot.category}`]||tokens[round];}).filter(Boolean))];
 const receipts=new Map(await Promise.all(keys.map(async token=>[token,(await api('/api/mine',{token})).entry])));
 const savedTokens=Object.values(tokens).slice(-100);
 const myRequests=savedTokens.length?(await api('/api/my-requests',{method:'POST',data:{tokens:savedTokens}})).entries:[];
 state=next;
 for(const slot of slots){
  slot.round=state.round+Number(slot.reserved);const token=tokens[`${slot.round}:${slot.category}`]||tokens[slot.round];const entry=receipts.get(token);
  slot.entry=entry&&entry.round===slot.round&&(entry.category||classifyArtist(entry.artist))===slot.category?entry:null;slot.token=slot.entry?token:null;
  if (slot.editing && (slot.editing.id !== slot.entry?.id || !slot.entry.songEditable)) stopEditing(slot);
  part(slot,'.slot-form').hidden=!!slot.entry && !slot.editing;
  part(slot,'.slot-receipt').hidden=!slot.entry || !!slot.editing;
  if(slot.entry){const mine=slot.entry;part(slot,'.slot-song').textContent=mine.song;part(slot,'.slot-artist').textContent=mine.artist;part(slot,'.slot-name').textContent=`${mine.name} さん`;part(slot,'.slot-status').textContent=slot.reserved&&mine.status==='pending'?'次回の抽選に入ります。':statusText[mine.status];part(slot,'.slot-edit').closest('.edit-actions').hidden=!mine.songEditable;}
 }
 renderDuplicateSlots();
 renderNameControls();
 renderHistory(myRequests);
}
async function confirmSong(data){
 const status=await api(`/api/song-status?${new URLSearchParams({artist:data.artist,song:data.song})}`);if(!status.unknownAt)return true;
 const formatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
 $('unknown-description').textContent=(status.reasons||[{reason:'unknown',at:status.unknownAt}]).map(item=>item.reason==='no_audio'?`${formatter.format(item.at)}時点では、この曲の音源がありませんでした。`:`${formatter.format(item.at)}時点では、えむぴーがこの曲をまだ覚えていませんでした。`).join('\n')+'\nそれでもリクエストしますか？';
 const dialog=$('unknown-warning');dialog.returnValue='';const confirmed=await new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='request'),{once:true});dialog.showModal();});if(confirmed)data.unknownAcknowledgedAt=status.unknownAt;return confirmed;
}
function hideSuggestions(except){for(const slot of slots)for(const kind of ['artist','song']){const input=field(slot,kind);if(input.tagName!=='SELECT'&&input!==except){field(slot,`${kind}-suggestions`).hidden=true;input.setAttribute('aria-expanded','false');}}}
function suggest(slot,kind){
 const input=field(slot,kind),box=field(slot,`${kind}-suggestions`),value=normalize(input.value);hideSuggestions(input);box.replaceChildren();if(!value){box.hidden=true;input.setAttribute('aria-expanded','false');return;}
 let candidates;
 if(kind==='artist')candidates=[...new Map(items.filter(i=>classifyArtist(i.artist)===slot.category&&[i.artist,...(i.artistAliases||[])].some(v=>normalize(v).includes(value))).map(i=>[i.artist,{label:i.artist}])).values()];
 else {const artistField = field(slot, 'artist');
  const artist = normalize(artistField.value);
  const artists = artistField.tagName === 'SELECT'
    ? new Set([artist])
    : new Set(items.filter(i => [i.artist, ...(i.artistAliases || [])].some(v => normalize(v) === artist)).map(i => normalize(i.artist)));candidates=items.filter(i=>classifyArtist(i.artist)===slot.category&&(!artist||artists.has(normalize(i.artist)))&&[i.song,...(i.aliases||[])].some(v=>normalize(v).includes(value))).map(i=>({label:`${i.song} · ${i.artist}`,item:i}));}
 for(const candidate of candidates.slice(0,7)){const button=document.createElement('button');button.type='button';button.textContent=candidate.label;button.onclick=()=>{slot.draftRound??=slot.round;input.value=kind==='artist'?candidate.label:candidate.item.song;if(kind==='song'&&!field(slot,'artist').value)field(slot,'artist').value=candidate.item.artist;box.hidden=true;input.setAttribute('aria-expanded','false');lock(busy);input.focus();};box.append(button);}
 box.hidden=!box.children.length;input.setAttribute('aria-expanded',String(!box.hidden));
}
function stopEditing(slot) {
 slot.editing = null;
 slot.draftRound = null;
 const form = part(slot, '.slot-form');
 form.reset();
 form.hidden = !!slot.entry;
 part(slot, '.slot-receipt').hidden = !slot.entry;
 setSongActions(slot, false);
 part(slot, '.slot-submit').textContent = slot.reserved ? '予約する' : 'リクエスト';
 part(slot, '.slot-cancel').hidden = true;
 hideSuggestions();
}
function setSongActions(slot, editing) {
 const form = part(slot, '.slot-form');
 const actions = part(slot, '.slot-actions');
 const save = part(slot, '.slot-submit');
 if (editing) {
  part(slot, '.input-group').append(actions);
  actions.prepend(part(slot, '.slot-cancel'));
 } else {
  form.append(actions);
 }
 actions.classList.toggle('edit-actions', editing);
 save.classList.toggle('primary', !editing);
 save.classList.toggle('text-button', editing);
 save.classList.toggle('edit-save', editing);
}
function renderNameControls() {
 const hasEditable = slots.some(slot => slot.entry?.editable);
 if (!hasEditable && nameEditing) {
  $('name').value = nameBeforeEdit;
  nameEditing = false;
 }
 $('name').readOnly = hasEditable && !nameEditing;
 $('name-actions').hidden = !hasEditable;
 $('edit-name').hidden = nameEditing;
 $('cancel-name').hidden = !nameEditing;
 $('save-name').hidden = !nameEditing;
 lock(busy);
}
let nameBeforeEdit;
function nameFeedback(text, error = false) {
 const node = $('name-feedback');
 node.hidden = !text;
 node.textContent = text;
 node.classList.toggle('error', error);
}
$('edit-name').onclick = () => {
 nameBeforeEdit = $('name').value;
 nameEditing = true;
 nameFeedback('');
 renderNameControls();
 $('name').focus();
 $('name').select();
};
$('cancel-name').onclick = () => {
 $('name').value = nameBeforeEdit;
 nameEditing = false;
 renderDuplicateSlots();
 renderNameControls();
 $('edit-name').focus();
};
$('name-form').onsubmit = async event => {
 event.preventDefault();
 const ownedTokens = slots.filter(slot => slot.entry?.editable).map(slot => slot.token);
 if (busy || !nameEditing || !ownedTokens.length) return;
 lock(true);
 nameFeedback('');
 try {
  const name = $('name').value;
  await api('/api/mine', {method: 'PATCH', data: {action: 'renameAll', tokens: ownedTokens, name}});
  $('name').value = name.normalize('NFKC').trim();
  safeSet('emupi-request-name', $('name').value);
  nameEditing = false;
  renderNameControls();
  await refresh();
  nameFeedback('名前を修正しました。');
 } catch (error) {
  nameFeedback(error.message, true);
 } finally {
  lock(false);
  if (!nameEditing) $('edit-name').focus();
 }
};
for(const slot of slots){
 const duplicate = document.createElement('div');
 duplicate.className = 'slot-receipt slot-duplicate';
 duplicate.hidden = true;
 duplicate.setAttribute('role', 'status');
 const rejected = document.createElement('p');
 rejected.className = 'edit-feedback error duplicate-error';
 rejected.textContent = slot.reserved ? 'すでに予約があるため、今入力した曲は予約されませんでした。' : 'すでにリクエストがあるため、今入力した曲は送信されませんでした。';
 const status = document.createElement('p');
 status.className = 'duplicate-label';
 status.textContent = slot.reserved ? 'この枠は予約済みです。' : 'この枠はリクエスト済みです。';
 duplicate.append(status, rejected);
 slot.root.append(duplicate);
 const box=document.createElement('div');box.className='slot-feedback edit-feedback';box.hidden=true;box.setAttribute('role','status');slot.root.prepend(box);
 part(slot, '.slot-form').onsubmit = async event => {
  event.preventDefault();
  if (!canSubmit(slot)) return;
  const editing = slot.editing;
  if (!editing && !$('name').reportValidity()) return;
  lock(true);
  feedback(slot, '');
  message('');
  const round = slot.draftRound ?? slot.round;
  const data = Object.fromEntries(new FormData(event.target));
  const name = $('name').value;
  let savedEdit = false;
  try {
   if (!await confirmSong(data)) { field(slot, 'song').focus(); return; }
   if (editing) {
    await api('/api/mine', {method: 'PATCH', data: {...data, action: 'editSong'}, token: editing.token});
    stopEditing(slot);
    await refresh();
    feedback(slot, '曲を修正しました。', false);
    savedEdit = true;
   } else {
    const {entry} = await api('/api/requests', {
     method: 'POST', data: {...data, name, round, category: slot.category},
     token: tokenFor(round, slot.category)
    });
    safeSet('emupi-request-name', entry.name);
    field(slot, 'song').value = '';
    slot.draftRound = null;
    await refresh();
   }
  } catch (error) {
   if (!editing && error.code === 'duplicate_request') {
    const key = duplicateKey(round, slot.category, name);
    confirmedDuplicates = [...new Set([...confirmedDuplicates, key])].slice(-24);
    safeSet(duplicateStorageKey, JSON.stringify(confirmedDuplicates));
    safeSet('emupi-request-name', name.trim());
    slot.draftRound = null;
    await refresh().catch(() => renderDuplicateSlots());
    return;
   }
   feedback(slot, error.message);
   if (error.status === 409) { slot.draftRound = null; await refresh().catch(() => {}); }
  } finally {
   lock(false);
   if (savedEdit) part(slot, '.slot-edit').focus();
  }
 };
 part(slot, '.slot-edit').onclick = () => {
  const entry = slot.entry;
  if (busy || !entry?.songEditable) return;
  slot.editing = {id: entry.id, token: slot.token};
  const artist = field(slot, 'artist');
  artist.value = entry.artist;
  if (artist.tagName === 'SELECT' && !artist.value) {
   const known = items.find(item => normalize(item.artist) === normalize(entry.artist))
    || items.find(item => (item.artistAliases || []).some(alias => normalize(alias) === normalize(entry.artist))
     && [item.song, ...(item.aliases || [])].some(song => normalize(song) === normalize(entry.song)));
   artist.value = known?.artist || '';
   if (!artist.value) artist.selectedIndex = 0;
  }
  field(slot, 'song').value = entry.song;
  const form = part(slot, '.slot-form');
  form.hidden = false;
  part(slot, '.slot-receipt').hidden = true;
  setSongActions(slot, true);
  part(slot, '.slot-submit').textContent = '曲を保存';
  part(slot, '.slot-cancel').hidden = false;
  feedback(slot, '');
  lock(busy);
  field(slot, 'song').focus();
 };
 part(slot, '.slot-cancel').onclick = () => {
  stopEditing(slot);
  feedback(slot, '');
  lock(busy);
  part(slot, '.slot-edit').focus();
 };
 for(const kind of ['artist','song']){const input=field(slot,kind);
  if (input.tagName === 'SELECT') {
   input.addEventListener('focus', () => hideSuggestions());
   input.addEventListener('change', () => {
    slot.draftRound ??= slot.round;
    field(slot, 'song').value = '';
    hideSuggestions();
    feedback(slot, '');
    lock(busy);
   });
   continue;
  }
  input.oninput=()=>{slot.draftRound??=slot.round;suggest(slot,kind);lock(busy);};input.onfocus=()=>hideSuggestions(input);input.onkeydown=event=>{const buttons=[...field(slot,`${kind}-suggestions`).querySelectorAll('button')];if(event.key==='ArrowDown'&&buttons.length){event.preventDefault();buttons[0].focus();}if(event.key==='Escape')hideSuggestions();};}
}
$('name').addEventListener('input', () => { renderDuplicateSlots(); lock(busy); });
lock(false);
document.addEventListener('click',event=>{if(!event.target.closest('.sug-wrap'))hideSuggestions();});
try{await refresh();items=(await api('/api/suggestions')).items;message('');}catch(error){message(error.message,true);}
setInterval(()=>{if(!document.hidden&&!busy)refresh().catch(error=>message(error.message,true));},15000);
