import { classifyArtist, categoryLabel } from './categories.mjs';
import { api, $, message, safeGet, safeSet, normalize, statusText } from './common.mjs';
let state, items=[], tokens, busy=false, nameEditing=false;
let receipts = new Map(), myRequests = [], namedRequests = [], loadedName = '', lookupTimer, lookupVersion = 0;
let account = { enabled: false, signedIn: false, entries: [], receipts: [] };
let refreshVersion = 0;
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
  const key = duplicateKey(slot.round, slot.category, $('name').value);
  const duplicate = !slot.entry && confirmedDuplicates.includes(key);
  const showError = slot.rejectedSubmission?.key === key && Date.now() < slot.rejectedSubmission.until;
  const receipt = part(slot, '.slot-duplicate');
  receipt.hidden = !duplicate && !showError;
  receipt.classList.toggle('has-error', showError);
  part(slot, '.duplicate-error').hidden = !showError;
  part(slot, '.slot-form').hidden = duplicate || (!!slot.entry && !slot.editing);
 }
 const reservation = $('next-reservation');
 reservation.hidden = !slots.filter(slot => !slot.reserved)
  .every(slot => slot.entry || !part(slot, '.slot-duplicate').hidden);
 if (reservation.hidden) reservation.open = false;
}
window.addEventListener('pageshow', renderDuplicateSlots);
document.addEventListener('visibilitychange', renderDuplicateSlots);
const slots=[...document.querySelectorAll('.request-slot')].map(root=>({root,id:root.id,category:root.dataset.category,reserved:root.dataset.reserved==='true',entry:null,token:null,round:null,draftRound:null}));
const field=(slot,name)=>$(`${slot.id}-${name}`);
const part=(slot,selector)=>slot.root.querySelector(selector);
$('name').value=safeGet('emupi-request-name')||'';
const entryForm = $('entry-form');
const entryName = $('entry-name');
const entryPasscode = $('entry-passcode');
const rememberedNameKey = 'emupi-request-last-name';
entryName.value = $('name').value || safeGet(rememberedNameKey) || '';
let entryMode = 'guest', entryBusy = false;
function showRequestScreen(open, focus = false) {
 $('entry-screen').hidden = open;
 $('request-screen').hidden = !open;
 if (focus) (open ? $('request-title') : entryName).focus();
}
const hasSavedName = Boolean($('name').value.trim());
entryBusy = hasSavedName;
showRequestScreen(false);
window.history.replaceState({requestScreen:false}, '');
function updateEntryButton() {
 entryName.readOnly = entryBusy;
 entryPasscode.readOnly = entryBusy;
 $('enter-request').disabled = entryBusy || !entryName.value.trim() || (entryMode !== 'guest' && !/^\d{4}$/.test(entryPasscode.value));
}
function passcodeFeedback(text) {
 $('passcode-feedback').textContent = text;
 $('passcode-feedback').hidden = !text;
}
function setEntryMode(mode) {
 if (entryBusy) return;
 entryMode = mode;
 const guest = mode === 'guest';
 $('entry-name-help').textContent = mode === 'login'
  ? '登録したときの名前を入力してください。'
  : 'えむぴーが見て誰か分かる名前なら、略称やニックネームでもOKです。';
 $('guest-entry-note').hidden = !guest;
 if (guest) $('enter-request').setAttribute('aria-describedby', 'guest-entry-note');
 else $('enter-request').removeAttribute('aria-describedby');
 $('passcode-field').hidden = guest;
 $('passcode-options').hidden = !guest || !account.passcodeEnabled;
 $('cancel-passcode').hidden = guest;
 entryPasscode.required = !guest;
 entryPasscode.value = '';
 entryPasscode.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
 $('enter-request').textContent = { guest:'名前だけで始める', register:'パスコードを設定して始める', login:'パスコードでログイン' }[mode];
 passcodeFeedback('');
 updateEntryButton();
 if (!guest) (entryName.value.trim() ? entryPasscode : entryName).focus();
}
function openPasscode(mode) {
 entryName.value = lookupName();
 window.history.pushState({requestScreen:false}, '');
 showRequestScreen(false);
 setEntryMode(mode);
}
function promptForPasscode(name) {
 ++lookupVersion;
 $('name').value = '';
 safeSet('emupi-request-name', '');
 safeSet(rememberedNameKey, name);
 entryName.value = name;
 window.history.replaceState({requestScreen:false}, '');
 showRequestScreen(false);
 setEntryMode('login');
 passcodeFeedback('この名前にはパスコードが設定されています。');
}
async function requiresPasscode(name) {
 return (await api('/api/passcode/entry', {method:'POST', data:{name}})).requiresPasscode;
}
$('choose-passcode').onclick = () => setEntryMode('register');
$('choose-passcode-login').onclick = () => setEntryMode('login');
$('cancel-passcode').onclick = () => { setEntryMode('guest'); entryName.focus(); };
$('manage-passcode').onclick = () => openPasscode('register');
$('manage-passcode-login').onclick = () => openPasscode('login');
entryName.addEventListener('input', updateEntryButton);
entryName.addEventListener('change', updateEntryButton);
entryPasscode.addEventListener('input', updateEntryButton);
window.addEventListener('pageshow', updateEntryButton);
updateEntryButton();
entryForm.onsubmit = async event => {
 event.preventDefault();
 const name = entryName.value.normalize('NFKC').trim();
 if (!name || entryBusy) return;
 const mode = entryMode;
 let displayName = name;
 entryBusy = true;
 updateEntryButton();
 passcodeFeedback('');
 message('');
 let needsPasscode = false;
 try {
  if (mode === 'guest') {
   needsPasscode = await requiresPasscode(name);
  } else {
   const tokensToLink = mode === 'register' ? {tokens:Object.values(tokens).slice(-100)} : {};
   const result = await api(`/api/passcode/${mode}`, {method:'POST', data:{name, passcode:entryPasscode.value, ...tokensToLink}});
   displayName = result.name;
  }
 } catch (error) {
  needsPasscode = error.code === 'passcode_required';
  if (!needsPasscode) {
   if (mode === 'guest') message(error.message, true);
   else passcodeFeedback(error.message);
   return;
  }
 } finally {
  entryBusy = false;
  updateEntryButton();
 }
 if (needsPasscode) {
  promptForPasscode(name);
  return;
 }
 $('name').value = displayName;
 safeSet('emupi-request-name', displayName);
 setEntryMode('guest');
 window.history.pushState({requestScreen:true}, '');
 showRequestScreen(true, true);
 if (state) renderRequests();
 if (mode === 'guest') {
  await refreshNameRequests(true);
 } else {
  $('account-settings').open = true;
  const savedTokens = Object.values(tokens).slice(-100);
  if (savedTokens.length) {
   await accountAction('/api/listener-account', {tokens:savedTokens}, result => result.linked
    ? `${result.linked}件のリクエストを連携しました。`
    : mode === 'register' ? 'パスコードを設定しました。' : 'ログインしました。');
  } else {
   try { await refresh(); } catch (error) { message(error.message, true); }
  }
 }
};
window.addEventListener('popstate', event => {
 if (typeof event.state?.requestScreen !== 'boolean') return;
 const open = event.state.requestScreen && Boolean(lookupName());
 if (!open) {
  entryName.value = lookupName() || safeGet(rememberedNameKey) || '';
  updateEntryButton();
 }
 showRequestScreen(open, true);
});
function tokenFor(round,category){const key=`${round}:${category}`;if(!tokens[key]){tokens[key]=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');safeSet('emupi-request-tokens',JSON.stringify(tokens));}return tokens[key];}
function canSubmit(slot) {
 const fields = [field(slot, 'artist'), field(slot, 'song')];
 if (!slot.editing) fields.push($('name'));
 return !!state && !busy && !nameEditing && fields.every(input => input.value.trim() && input.validity.valid);
}
function lock(value) {
 busy = value;
 for (const button of document.querySelectorAll('.slot-cancel, .slot-edit, #save-name, #edit-name, #cancel-name, #line-link, #request-logout')) button.disabled = busy;
 for (const slot of slots) part(slot, '.slot-submit').disabled = !canSubmit(slot);
}
function feedback(slot, text, error = true) {
 const box = part(slot, '.slot-feedback');
 const container = slot.editing || !slot.entry ? part(slot, '.input-group') : part(slot, '.slot-receipt');
 const actions = container.querySelector(':scope > .edit-actions, :scope > .slot-receipt-footer');
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
 const version = ++refreshVersion;
 const [next, nextAccount] = await Promise.all([api('/api/state'), api('/api/listener-account')]);
 const keys=[...new Set(slots.map(slot=>{const round=next.round+Number(slot.reserved);return tokens[`${round}:${slot.category}`]||tokens[round];}).filter(Boolean))];
 const savedTokens=Object.values(tokens).slice(-100);
 const [owned, history] = await Promise.all([
  Promise.all(keys.map(async token => [token, (await api('/api/mine', {token})).entry])),
  savedTokens.length ? api('/api/my-requests', {method:'POST', data:{tokens:savedTokens}}) : {entries:[]}
 ]);
 if (version !== refreshVersion) return;
 receipts = new Map(owned);
 myRequests = history.entries;
 if (!account.signedIn && nextAccount.signedIn && nextAccount.name && !nameEditing) {
  $('name').value = nextAccount.name;
  safeSet('emupi-request-name', nextAccount.name);
  window.history.replaceState({requestScreen:true}, '');
  showRequestScreen(true);
 }
 account = nextAccount;
 state=next;
 renderRequests();
 await refreshNameRequests();
}
function lookupName() {
 return (nameEditing ? nameBeforeEdit : $('name').value).normalize('NFKC').trim();
}
async function refreshNameRequests(reportError = false) {
 const name = lookupName();
 const version = ++lookupVersion;
 if (!name || nameEditing) return;
 try {
  const {entries} = await api('/api/requests-by-name', {method:'POST', data:{name}});
  if (version !== lookupVersion || name !== lookupName()) return;
  loadedName = name;
  namedRequests = entries;
  if (entries.length && !nameEditing) safeSet('emupi-request-name', name);
  if (state) renderRequests();
 } catch (error) {
  if (reportError && version === lookupVersion && name === lookupName() && !nameEditing) nameFeedback(error.message, true);
 }
}
function renderRequests() {
 const restored = loadedName === lookupName() ? namedRequests : [];
 for(const slot of slots){
  slot.round = state.round + Number(slot.reserved);
  const token = tokens[`${slot.round}:${slot.category}`] || tokens[slot.round];
  const entry = receipts.get(token);
  const matches = candidate => candidate && candidate.round === slot.round && (candidate.category || classifyArtist(candidate.artist)) === slot.category;
  const linked = account.receipts.find(matches);
  const owned = matches(entry);
  slot.entry = linked || (owned ? entry : restored.find(matches)) || null;
  slot.token = !linked && owned ? token : null;
  if (slot.editing && (slot.editing.id !== slot.entry?.id || !slot.entry.songEditable)) stopEditing(slot);
  part(slot,'.slot-form').hidden=!!slot.entry && !slot.editing;
  part(slot,'.slot-receipt').hidden=!slot.entry || !!slot.editing;
  if(slot.entry){const mine=slot.entry;part(slot,'.slot-song').textContent=mine.song;part(slot,'.slot-artist').textContent=mine.artist;part(slot,'.slot-status').textContent=slot.reserved&&mine.status==='pending'?'予約済み':mine.status==='pending'?'抽選待ち':mine.status==='done'?'歌唱済み':statusText[mine.status];part(slot,'.slot-edit').closest('.edit-actions').hidden=!mine.songEditable;}
 }
 renderDuplicateSlots();
 renderNameControls();
 const history = new Map([...restored, ...myRequests, ...account.entries].map(entry => [entry.id, entry]));
 renderHistory([...history.values()].sort((a, b) => a.createdAt - b.createdAt));
 renderAccount();
}
function renderAccount() {
 $('entry-line').hidden = !account.enabled || account.signedIn;
 $('passcode-options').hidden = !account.passcodeEnabled || entryMode !== 'guest' || account.signedIn;
 $('manage-passcode').hidden = !account.passcodeEnabled || account.signedIn;
 $('manage-passcode-login').hidden = !account.passcodeEnabled || account.signedIn;
 $('line-start').hidden = !account.enabled || account.signedIn;
 const linked = new Set(account.entries.map(entry => entry.id));
 $('line-link').hidden = !account.signedIn || !myRequests.some(entry => !linked.has(entry.id));
 $('account-settings').hidden = ['manage-passcode', 'manage-passcode-login', 'line-start', 'line-link'].every(id => $(id).hidden) &&
  !$('line-feedback').textContent;
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
 const editable = slots.filter(slot => slot.entry?.editable);
 const ownedTokens = editable.map(slot => slot.token).filter(Boolean);
 if (busy || !nameEditing || !editable.length) return;
 lock(true);
 nameFeedback('');
 try {
  const name = $('name').value;
  await api('/api/mine', {method: 'PATCH', data: {action: 'renameAll', tokens: ownedTokens, account: editable.some(slot => !slot.token), name}});
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
 rejected.hidden = true;
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
    await api('/api/mine', {
     method: 'PATCH', data: {...data, action: 'editSong', ...(!editing.token && {requestId: editing.id})}, token: editing.token
    });
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
   if (error.code === 'passcode_required') {
    promptForPasscode(name);
    return;
   }
   if (!editing && error.code === 'duplicate_request') {
    const key = duplicateKey(round, slot.category, name);
    const errorDuration = 30_000;
    slot.rejectedSubmission = {key, until: Date.now() + errorDuration};
    setTimeout(renderDuplicateSlots, errorDuration);
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
$('name').addEventListener('input', () => {
 if (nameEditing) return;
 nameFeedback('');
 clearTimeout(lookupTimer);
 ++lookupVersion;
 if (state) renderRequests();
 lock(busy);
 if (lookupName()) lookupTimer = setTimeout(() => refreshNameRequests(true), 350);
});
async function accountAction(path, data, notice) {
 if (busy) return;
 lock(true);
 const status = $('line-feedback');
 status.textContent = '';
 try {
  const result = await api(path, {method:'POST', data});
  await refresh();
  status.textContent = notice(result);
 } catch (error) {
  status.textContent = error.message;
 } finally {
  lock(false);
  renderAccount();
 }
}
$('line-link').onclick = () => accountAction('/api/listener-account', {tokens: Object.values(tokens).slice(-100)},
 result => result.linked ? `${result.linked}件のリクエストを連携しました。` : '新しく連携できるリクエストはありません。');
$('request-logout').onclick = async () => {
 if (busy) return;
 lock(true);
 try {
  await api('/auth/line/logout', {method:'POST', data:{}});
  const lastName = lookupName();
  ++lookupVersion;
  clearTimeout(lookupTimer);
  nameEditing = false;
  $('name').value = '';
  entryName.value = lastName;
  safeSet(rememberedNameKey, lastName);
  safeSet('emupi-request-name', '');
  setEntryMode('guest');
  for (const slot of slots) {
   stopEditing(slot);
   feedback(slot, '');
  }
  $('my-history').open = false;
  $('account-settings').open = false;
  $('line-feedback').textContent = '';
  $('entry-line-feedback').textContent = 'ログアウトしました。';
  $('entry-line-feedback').hidden = false;
  window.history.replaceState({requestScreen:false}, '');
  showRequestScreen(false, true);
  await refresh();
 } catch (error) {
  message(error.message, true);
 } finally {
  lock(false);
 }
};
const pageUrl = new URL(location.href);
if (pageUrl.searchParams.has('line')) {
 $('account-settings').open = true;
 const notice = pageUrl.searchParams.get('line') === 'connected' ? 'LINEでログインしました。' : 'LINEでログインできませんでした。もう一度お試しください。';
 $('line-feedback').textContent = notice;
 $('entry-line-feedback').textContent = notice;
 $('entry-line-feedback').hidden = false;
 pageUrl.searchParams.delete('line');
 window.history.replaceState(window.history.state, '', pageUrl);
}
lock(false);
document.addEventListener('click',event=>{if(!event.target.closest('.sug-wrap'))hideSuggestions();});
try {
 await refresh();
 if (hasSavedName) {
  const name = lookupName();
  const needsPasscode = !account.signedIn && await requiresPasscode(name);
  entryBusy = false;
  if (needsPasscode) promptForPasscode(name);
  else {
   window.history.replaceState({requestScreen:true}, '');
   showRequestScreen(true);
  }
 }
 items = (await api('/api/suggestions')).items;
} catch (error) {
 message(error.message, true);
} finally {
 entryBusy = false;
 updateEntryButton();
}
setInterval(()=>{if(!document.hidden&&!busy)refresh().catch(error=>message(error.message,true));},15000);
