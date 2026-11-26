import { artistSearchNames, songSearchNames } from './suggestion-readings.mjs?v=kana';
import { closeMenu } from './site-menu.mjs?layout=keep-menu';
import { classifyArtist, categoryLabel } from './categories.mjs';
import { api, $, message, safeGet, safeSet, normalize } from './common.mjs';
let state, items=[], tokens, busy=false;
let receipts = new Map(), myRequests = [], namedRequests = [], loadedName = '', lookupVersion = 0;
let account = { enabled: false, signedIn: false, entries: [], receipts: [] };
let archive = null;
let refreshVersion = 0;
try { tokens=JSON.parse(safeGet('emupi-request-tokens')||'{}'); } catch { tokens={}; }
const duplicateStorageKey = 'emupi-duplicate-requests';
let confirmedDuplicates = [];
try {
 const saved = JSON.parse(safeGet(duplicateStorageKey) || '[]');
 if (Array.isArray(saved)) confirmedDuplicates = saved;
} catch {}
const duplicateKey = (round, category, name) => JSON.stringify([round, category, name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()]);
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
 reservation.hidden = !currentSlots.every(hasSlotRequest);
 if (reservation.hidden) {
  reservation.open = false;
  if (activeSlot?.reserved) {
   window.history.replaceState({...window.history.state, currentSlot:null}, '');
   showSlot(null, !activeMenuPage);
  }
 }
 $('after-draw-note').hidden = !currentSlots.some(slot => slot.entry && slot.entry.status !== 'pending');
 const hasReservationSpace = reservationSlots.some(slot => !hasSlotRequest(slot));
 $('after-draw-reservation').hidden = !hasReservationSpace || reservation.hidden;
 $('after-draw-reservation-locked').hidden = !hasReservationSpace || !reservation.hidden;
 for (const slot of slots) renderSlotOverview(slot);
}
window.addEventListener('pageshow', renderDuplicateSlots);
document.addEventListener('visibilitychange', renderDuplicateSlots);
const slots = [...document.querySelectorAll('.request-slot')].map(root => {
 const overview = $(`open-${root.id}`);
 return {root, id:root.id, category:root.dataset.category, reserved:root.dataset.reserved === 'true',
  entry:null, token:null, round:null, draftRound:null, overview, detail:$(overview.getAttribute('aria-controls'))};
});
const field=(slot,name)=>$(`${slot.id}-${name}`);
const part=(slot,selector)=>slot.root.querySelector(selector);
const currentSlots = slots.filter(slot => !slot.reserved);
const reservationSlots = slots.filter(slot => slot.reserved);
const jacketSources = new Map(currentSlots.map(slot => [slot.category, slot.overview.querySelector('img').getAttribute('src')]));
function jacket(category, className, size) {
 const image = document.createElement('img');
 image.src = jacketSources.get(category);
 image.alt = '';
 image.className = className;
 image.width = image.height = size;
 return image;
}
for (const slot of slots) {
 const receipt = part(slot, '.slot-receipt');
 const summary = document.createElement('div');
 summary.className = 'receipt-summary';
 const identity = document.createElement('div');
 identity.append(part(slot, '.slot-song'), part(slot, '.slot-artist'));
 summary.append(jacket(slot.category, 'slot-overview-art', 76), identity, part(slot, '.slot-status'));
 receipt.prepend(summary);
}
const userCurrentList = $('user-current-list');
const userCurrentRows = currentSlots.map(slot => {
 const row = slot.overview.cloneNode(true);
 row.removeAttribute('id');
 row.classList.remove('is-empty');
 row.hidden = true;
 userCurrentList.append(row);
 row.onclick = () => {
  if (busy) return;
  closeMenu();
  const method = activeSlot || activeMenuPage ? 'replaceState' : 'pushState';
  window.history[method]({requestScreen:true, currentSlot:slot.id}, '');
  showMenuPage(null);
  showSlot(slot.id, true);
 };
 return {slot, row};
});
function renderUserCurrentRequests() {
 let count = 0;
 for (const {slot, row} of userCurrentRows) {
  const entry = slot.entry;
  row.hidden = !entry || !['pending', 'selected'].includes(entry.status);
  if (row.hidden) continue;
  count++;
  row.querySelector('strong').textContent = entry.song;
  const artist = row.querySelector('.slot-overview-song');
  artist.textContent = entry.artist;
  artist.hidden = !entry.artist;
  renderStatusTag(row.querySelector('.slot-overview-status'), requestStatusKey(entry));
 }
 userCurrentList.hidden = count === 0;
 $('user-current-empty').hidden = count !== 0;
}
const reservation = $('next-reservation');
let activeSlot = null;
const requestStatusLabels = {unrequested:'未リクエスト', submitted:'リクエスト済み', reserved:'予約済み', temporary:'一時保留', pending:'抽選待ち', selected:'当選', done:'当選済み', skipped:'見送り', deferred:'次回に持ち越し', removed:'取り下げ済み'};
function requestStatusKey(entry, reserved = false) {
 if (reserved && entry.status === 'pending') return 'reserved';
 if (entry.status === 'deferred' && entry.deferReason === 'temporary') return 'temporary';
 return entry.status;
}
function renderStatusTag(node, key) {
 node.dataset.statusTag = key;
 node.textContent = requestStatusLabels[key] ?? key;
}

function hasSlotRequest(slot) {
 return Boolean(slot.entry || !part(slot, '.slot-duplicate').hidden);
}

function renderSlotOverview(slot) {
 const title = slot.overview.querySelector('strong');
 const artist = slot.overview.querySelector('.slot-overview-song');
 const category = slot.overview.querySelector('.slot-overview-category');
 const status = slot.overview.querySelector('.slot-overview-status');
 const empty = !hasSlotRequest(slot);
 title.textContent = slot.entry?.song || categoryLabel(slot.category);
 artist.textContent = slot.entry?.artist || '';
 artist.hidden = !artist.textContent;
 category.hidden = !slot.entry;
 if (slot.entry) renderStatusTag(status, requestStatusKey(slot.entry, slot.reserved));
 else if (empty && slot.reserved) {
  delete status.dataset.statusTag;
  status.textContent = '予約する';
 } else renderStatusTag(status, empty ? 'unrequested' : slot.reserved ? 'reserved' : 'submitted');
 slot.overview.classList.toggle('is-empty', empty);
}
function showSlot(id, focus = false) {
 const previous = activeSlot;
 activeSlot = slots.find(slot => slot.id === id && (!slot.reserved || !reservation.hidden)) || null;
 if (activeSlot?.reserved) reservation.open = true;
 $('request-overview').hidden = Boolean(activeSlot);
 $('request-detail').hidden = !activeSlot;
 $('reservation-detail-label').hidden = !activeSlot?.reserved;
 for (const slot of slots) slot.detail.hidden = slot !== activeSlot;
 const previousRow = previous && (!previous.reserved || !reservation.hidden) && previous.overview;
 if (focus) (activeSlot?.detail || previousRow || $('request-title')).focus();
}
function closeSlot() {
 if (activeSlot) window.history.back();
}
for (const slot of slots) {
 slot.overview.onclick = () => {
  if (activeSlot || busy) return;
  window.history.pushState({requestScreen:true, currentSlot:slot.id}, '');
  showSlot(slot.id, true);
 };
}
$('name').value=safeGet('emupi-request-name')||'';
const viewport = window.visualViewport;
if (viewport) {
 const fitLoginViewport = () => {
  const height = viewport.scale === 1 && viewport.height < window.innerHeight ? viewport.height + 'px' : '';
  document.body.style.setProperty('--login-viewport-height', height);
 };
 viewport.addEventListener('resize', fitLoginViewport);
 fitLoginViewport();
}
const entryForm = $('entry-form');
const entryTitle = $('entry-title');
const welcomeTitle = entryTitle.textContent;
const entryName = $('entry-name');
const entryPasscode = $('entry-passcode');
const nameSettings = $('listener-name-settings');
const newName = $('new-name');
const namePasscode = $('name-passcode');
const menuPage = $('menu-page');
const menuPageTitle = $('menu-page-title');
const menuPages = [...document.querySelectorAll('[data-menu-page]')].map(button => ({button, panel:$(button.dataset.menuPage)}));
const initialParams = new URLSearchParams(location.search);
const initialView = initialParams.get('view') ?? initialParams.get('preview');
let initialMenuPage = initialView === 'name-settings' ? nameSettings.id : initialView;
let activeMenuPage = null;
const greeting = $('listener-greeting');
const japanHour = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Tokyo', hour:'2-digit', hourCycle:'h23'});
const rememberedNameKey = 'emupi-request-last-name';
entryName.value = $('name').value || safeGet(rememberedNameKey) || '';
let entryMode = 'welcome', entryBusy = false;
const logoutNotice = $('logout-notice');
let logoutNoticeTimer;
function clearLogoutNotice() {
 if (!logoutNotice.textContent) return;
 clearTimeout(logoutNoticeTimer);
 logoutNotice.textContent = '';
}
document.addEventListener('click', clearLogoutNotice, true);
document.addEventListener('keydown', clearLogoutNotice, true);
const entryView = (mode, fromWelcome = false) => ({requestScreen:false, entryMode:mode, fromWelcome});
function showRequestScreen(open, focus = false) {
 $('entry-screen').hidden = open;
 $('request-screen').hidden = !open;
 for (const {button} of menuPages) if (button.hasAttribute('data-login-required')) button.hidden = !open;
 $('request-logout').hidden = !open;
 $('user-menu-toggle').hidden = !open;
 if (!open) {
  showMenuPage(null);
  showSlot(null);
 }
 if (open) renderGreeting();
 if (initialMenuPage) {
  const page = menuPages.find(({button, panel}) => !button.hidden && panel.id === initialMenuPage);
  initialMenuPage = null;
  if (page) {
   window.history.replaceState({...window.history.state, menuPage:page.panel.id, directMenuPage:true}, '');
   showMenuPage(page.panel.id, true);
   return;
  }
 }
 if (focus) (open ? $('request-title') : entryTitle).focus();
}
const hasSavedName = Boolean($('name').value.trim());
entryBusy = hasSavedName;
window.history.replaceState(entryView('welcome'), '');
const usesPasscode = mode => mode === 'register' || mode === 'login';
function updateEntryButton() {
 entryName.readOnly = entryBusy;
 entryPasscode.readOnly = entryBusy;
 $('enter-request').disabled = entryBusy || !entryName.value.trim() || (usesPasscode(entryMode) && !/^\d{4}$/.test(entryPasscode.value));
}
function passcodeFeedback(text) {
 $('passcode-feedback').textContent = text;
 $('passcode-feedback').hidden = !text;
}
function setEntryMode(mode, focus = false) {
 entryMode = mode;
 const welcome = mode === 'welcome';
 const guest = mode === 'guest';
 const login = mode === 'login' || mode === 'name-login';
 entryTitle.textContent = welcome ? welcomeTitle : login ? 'ログイン' : 'はじめての方';
 entryTitle.classList.toggle('request-heading-hidden', welcome);
 $('entry-welcome-actions').hidden = !welcome;
 entryForm.hidden = welcome;
 $('entry-name-help').hidden = login;
 if (login) entryName.removeAttribute('aria-describedby');
 else entryName.setAttribute('aria-describedby', 'entry-name-help');
 $('guest-entry-note').hidden = !guest;
 if (guest) $('enter-request').setAttribute('aria-describedby', 'guest-entry-note');
 else $('enter-request').removeAttribute('aria-describedby');
 $('passcode-field').hidden = !usesPasscode(mode);
 $('entry-passcode-help').hidden = mode !== 'register';
 if (mode === 'register') entryPasscode.setAttribute('aria-describedby', 'entry-passcode-help');
 else entryPasscode.removeAttribute('aria-describedby');
 $('entry-signin').hidden = !guest && mode !== 'register';
 $('entry-login-links').hidden = !login;
 $('choose-name-login').textContent = mode === 'name-login' ? 'パスコードでログイン' : '名前だけでログイン';
 $('choose-registration-mode').textContent = guest ? 'パスコードを設定して始める' : '名前だけで始める';
 entryPasscode.required = usesPasscode(mode);
 entryPasscode.value = '';
 entryPasscode.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
 $('enter-request').textContent = guest ? '名前だけで始める' : mode === 'register' ? 'パスコードを設定して始める' : 'ログイン';
 passcodeFeedback('');
 renderEntryOptions();
 updateEntryButton();
 if (focus) entryTitle.focus();
}
function navigateEntry(mode, replace = false) {
 if (entryBusy) return;
 const current = window.history.state;
 const fromWelcome = replace ? current?.fromWelcome : current?.entryMode === 'welcome';
 window.history[replace ? 'replaceState' : 'pushState'](entryView(mode, fromWelcome), '');
 showRequestScreen(false);
 message('');
 setEntryMode(mode, true);
}
function openPasscode(mode) {
 entryName.value = lookupName();
 navigateEntry(mode);
}
function promptForPasscode(name) {
 ++lookupVersion;
 $('name').value = '';
 safeSet('emupi-request-name', '');
 safeSet(rememberedNameKey, name);
 entryName.value = name;
 navigateEntry('login', true);
 passcodeFeedback('この名前にはパスコードが設定されています。');
 entryPasscode.focus();
}
async function requiresPasscode(name) {
 return (await api('/api/passcode/entry', {method:'POST', data:{name}})).requiresPasscode;
}
const registrationMode = () => account.passcodeEnabled === false ? 'guest' : 'register';
$('welcome-register').onclick = () => navigateEntry(registrationMode());
$('welcome-login').onclick = () => navigateEntry('login');
$('choose-registration-mode').onclick = () => navigateEntry(entryMode === 'register' ? 'guest' : 'register', true);
$('choose-passcode-login').onclick = () => navigateEntry('login', true);
$('choose-name-login').onclick = () => navigateEntry(entryMode === 'login' ? 'name-login' : 'login', true);
$('choose-register').onclick = () => navigateEntry(registrationMode(), true);
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
 if (!name || entryBusy || entryMode === 'welcome') return;
 const mode = entryMode;
 const nameOnly = !usesPasscode(mode);
 let displayName = name;
 entryBusy = true;
 updateEntryButton();
 passcodeFeedback('');
 message('');
 let needsPasscode = false;
 try {
  if (nameOnly) {
   needsPasscode = await requiresPasscode(name);
  } else {
   const tokensToLink = mode === 'register' ? {tokens:Object.values(tokens).slice(-100)} : {};
   const result = await api(`/api/passcode/${mode}`, {method:'POST', data:{name, passcode:entryPasscode.value, ...tokensToLink}});
   displayName = result.name;
  }
 } catch (error) {
  needsPasscode = error.code === 'passcode_required';
  if (!needsPasscode) {
   if (nameOnly) message(error.message, true);
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
 window.history.pushState({requestScreen:true}, '');
 showRequestScreen(true, true);
 setEntryMode('welcome');
 if (state) renderRequests();
 if (nameOnly) {
  await refreshNameRequests(true);
 } else {
  try { await refresh({useAccountName:true}); } catch (error) { message(error.message, true); }
 }
};
window.addEventListener('popstate', event => {
 clearLogoutNotice();
 if (typeof event.state?.requestScreen !== 'boolean') return;
 const open = event.state.requestScreen && Boolean(lookupName());
 const mode = event.state.entryMode || 'welcome';
 if (!open && entryMode !== mode) setEntryMode(mode);
 showRequestScreen(open);
 showMenuPage(event.state.menuPage, true);
 if (open) showSlot(event.state.currentSlot, !activeMenuPage);
 else if (!activeMenuPage) entryTitle.focus();
});
function showMenuPage(id, focus = false) {
 const previous = activeMenuPage;
 activeMenuPage = menuPages.find(({button,panel}) => panel.id === id && !button.hidden) || null;
 if (previous?.panel === nameSettings && previous !== activeMenuPage) namePasscode.value = '';
 menuPage.hidden = !activeMenuPage;
 for (const page of menuPages) page.panel.hidden = page !== activeMenuPage;
 if (!activeMenuPage) return;
 const {button,panel} = activeMenuPage;
 menuPageTitle.textContent = button.firstChild.textContent.trim();
 if (panel.id === 'playable-songs') showPlayableCategory(window.history.state);
 if (panel === nameSettings && activeMenuPage !== previous) {
  newName.value = lookupName();
  namePasscode.value = '';
  nameFeedback('');
 }
 if (focus) {
  window.scrollTo(0, 0);
  menuPageTitle.focus();
 }
 if (panel.id === 'my-history') void loadArchivedHistory();
 if (panel.id === 'played-history') void refreshPlayed();
 if (panel.id === 'playable-songs' && previous !== activeMenuPage) void refreshPlayable();
}
for (const {button,panel} of menuPages) {
 button.onclick = () => {
  if (activeMenuPage?.panel === panel) {
   closeMenu();
   const {playableCategory, playableView, playableArtist} = window.history.state || {};
   if (playableCategory) window.history.go(-(1 + Number(Boolean(playableView)) + Number(Boolean(playableArtist))));
   else menuPageTitle.focus();
   return;
  }
  const url = new URL(location.href);
  url.searchParams.delete('preview');
  url.searchParams.set('view', panel.id === nameSettings.id ? 'name-settings' : panel.id);
  location.assign(url);
 };
}
function goToRequestTop() {
 if (activeMenuPage && window.history.state?.directMenuPage) {
  const url = new URL(location.href);
  url.searchParams.delete('view');
  url.searchParams.delete('preview');
  location.replace(url);
  return;
 }
 closeMenu();
 const loggedIn = !$('request-screen').hidden;
 const focusTop = () => {
  window.scrollTo(0, 0);
  (loggedIn ? $('request-title') : entryTitle).focus({preventScroll:true});
 };
 if (activeMenuPage || activeSlot) {
  const backToWelcome = !loggedIn && entryMode !== 'welcome' && window.history.state?.fromWelcome;
  const steps = Number(Boolean(activeMenuPage)) + Number(Boolean(activeSlot || backToWelcome))
    + (window.history.state?.playableDepth || 0);
  window.addEventListener('popstate', focusTop, {once:true});
  window.history.go(-steps);
 } else if (!loggedIn && entryMode !== 'welcome') {
  if (entryBusy) return;
  if (window.history.state?.fromWelcome) window.history.back();
  else navigateEntry('welcome', true);
 } else {
  focusTop();
 }
}
$('request-menu-top').onclick = goToRequestTop;
$('review-requests').onclick = goToRequestTop;
$('request-home').onclick = event => {
 if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
 event.preventDefault();
 goToRequestTop();
};
function tokenFor(round,category){const key=`${round}:${category}`;if(!tokens[key]){tokens[key]=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');safeSet('emupi-request-tokens',JSON.stringify(tokens));}return tokens[key];}
function canSubmit(slot) {
 const fields = [field(slot, 'artist'), field(slot, 'song')];
 return !!state && !busy && (slot.editing || lookupName()) && fields.every(input => input.value.trim() && input.validity.valid);
}
function lock(value) {
 busy = value;
 for (const button of document.querySelectorAll('.slot-cancel, .slot-edit, #save-name, #cancel-name, #line-link, #request-logout, .slot-overview-row')) button.disabled = busy;
 newName.readOnly = namePasscode.readOnly = busy;
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
const japanDate = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo', dateStyle:'short'});
function historyRow(list, song, artist, status, timestamp, category = classifyArtist(artist), statusKey) {
 const row = document.createElement('li');
 const title = document.createElement('div');
 title.className = 'history-song';
 title.textContent = song;
 const subtitle = document.createElement('div');
 subtitle.className = 'history-artist';
 subtitle.textContent = artist;
 const identity = document.createElement('div');
 const meta = document.createElement('div');
 meta.className = 'history-status';
 meta.append(subtitle);
 if (Number.isFinite(timestamp)) {
  const date = document.createElement('time');
  date.dateTime = japanDate.format(timestamp);
  date.textContent = date.dateTime.replaceAll('-', '/');
  meta.append(date);
 }
 identity.append(title, meta);
 if (status) {
  const label = document.createElement('div');
  label.className = 'history-state';
  label.textContent = status;
  identity.append(label);
 }
 if (statusKey) {
  const tag = document.createElement('span');
  renderStatusTag(tag, statusKey);
  tag.className = 'history-tag';
  identity.append(tag);
 }
 if (category) row.append(jacket(category, 'history-art', 42));
 row.append(identity);
 list.append(row);
}
function historyOwner() {
 return lookupName() + ':' + (account.signedIn ? account.method : 'guest');
}
async function loadArchivedHistory(more = false) {
 if (!lookupName()) return;
 const owner = historyOwner();
 if (archive?.owner !== owner) archive = {owner, entries: [], next: null, loaded: false, loading: false, error: ''};
 const current = archive;
 if (current.loading || (current.loaded && !more) || (more && current.loaded && !current.next)) return;
 current.loading = true;
 current.error = '';
 if (state) renderRequests();
 try {
  const page = await api('/api/request-history', {method:'POST', data:{name:lookupName(), before:current.next}});
  current.entries.push(...page.entries);
  current.next = page.next;
  current.loaded = true;
 } catch (error) {
  current.error = error.message;
 } finally {
  current.loading = false;
  if (archive === current && historyOwner() === owner && state) renderRequests();
 }
}
$('my-history-more').onclick = () => loadArchivedHistory(true);

function renderHistory(myRequests){
 const current = archive?.owner === historyOwner() ? archive : null;
 $('my-history-empty').hidden = Boolean(myRequests.length || current?.loading || current?.error);
 $('my-history-count').textContent = myRequests.length ? `${myRequests.length}件${current?.next ? '以上' : ''}` : '';
 $('my-history-feedback').textContent = current?.loading ? '履歴を読み込み中…' : current?.error || '';
 $('my-history-feedback').hidden = !$('my-history-feedback').textContent;
 $('my-history-more').hidden = !current?.next && !current?.error;
 $('my-history-more').disabled = Boolean(current?.loading);
 $('my-history-more').textContent = current?.error ? '再読み込み' : 'もっと見る';
 $('my-history-list').replaceChildren();
 for(const entry of [...myRequests].reverse())historyRow($('my-history-list'),entry.song,entry.artist,`${categoryLabel(entry.category)} · ${entry.round>state.round?'次回の予約 · ':entry.round===state.round?'今回':'過去のリクエスト'}${entry.status!=='done'&&entry.playedThisSession?' · 同じ曲は今回歌唱済み':''}`,entry.createdAt, entry.category, requestStatusKey(entry, entry.round > state.round));
}
function renderPlayed(played) {
 $('played-count').textContent=played.length?`${played.length}曲`:'';$('played-empty').hidden=!!played.length;$('played-list').replaceChildren();
 for(const entry of [...played].reverse())historyRow($('played-list'),entry.song,entry.artist,entry.performedAt ? '' : '歌唱済み',entry.performedAt);
}
const playable = $('playable-songs');
const playableCategories = $('playable-categories');
const playableGroups = $('playable-groups');
const playableCategoryButtons = [...playableCategories.querySelectorAll('button')];
let playableSongs = null;
function showPlayableCategory({playableCategory: category, playableView: view, playableArtist: artist} = {}) {
 const selected = playableCategoryButtons.find(button => button.dataset.playableCategory === category);
 const browsing = Boolean(selected && view);
 playableCategories.hidden = Boolean(selected);
 playableGroups.hidden = !selected || browsing;
 $('playable-results').hidden = !browsing;
 for (const button of playableCategoryButtons) {
  $(`playable-${button.dataset.playableCategory}-detail`).hidden = button !== selected;
 }
 if (browsing) {
  menuPageTitle.textContent = artist || (view === 'artists' ? 'アーティスト' : '曲');
  renderPlayableResults(category, view, artist);
 }
}
function navigatePlayable(next) {
 const current = window.history.state;
 window.history.pushState({...current, ...next, playableDepth:(current.playableDepth || 0) + 1}, '');
 showMenuPage(playable.id, true);
}
for (const button of playableCategoryButtons) {
 button.onclick = () => navigatePlayable({playableCategory:button.dataset.playableCategory});
}
for (const button of $('playable-browse').querySelectorAll('button')) {
 button.onclick = () => navigatePlayable({playableView:button.dataset.playableView});
}
function renderPlayableResults(category, view, artist) {
 const artists = $('playable-artists');
 const tracks = $('playable-track-list');
 const showArtists = view === 'artists' && !artist;
 const songs = (playableSongs || []).filter(song => song.category === category && (!artist || song.artist === artist));
 artists.hidden = !showArtists;
 tracks.hidden = showArtists;
 artists.replaceChildren();
 tracks.replaceChildren();
 $('playable-empty').hidden = !playableSongs || songs.length > 0;
 if (showArtists) {
  for (const name of new Set(songs.map(song => song.artist))) {
   const button = document.createElement('button');
   button.type = 'button';
   button.textContent = name;
   button.onclick = () => navigatePlayable({playableArtist:name});
   artists.append(button);
  }
 } else {
  for (const song of songs) historyRow(tracks, song.song, song.artist, undefined, undefined, null);
 }
}
const songOrdering = new Intl.Collator('ja');
let playableLoading = false;
async function refreshPlayable() {
 if (playable.hidden || document.hidden || playableLoading) return;
 playableLoading = true;
 const feedback = $('playable-feedback');
 if (!playableSongs) {
  feedback.textContent = '読み込み中…';
  feedback.hidden = false;
 }
 try {
  const {songs} = await api('/api/repertoire');
  songs.sort((a,b) => songOrdering.compare(a.artist,b.artist) || songOrdering.compare(a.song,b.song));
  playableSongs = songs;
  const {playableCategory, playableView, playableArtist} = window.history.state || {};
  if (!playable.hidden && playableView) renderPlayableResults(playableCategory, playableView, playableArtist);
  feedback.hidden = true;
 } catch (error) {
  feedback.textContent = error.message;
  feedback.hidden = false;
 } finally {
  playableLoading = false;
 }
}
const playedHistory = $('played-history');
let publicReadVersion = 0, playedVersion = 0, playedLoading = false;
async function readPublicState() {
 const version = ++publicReadVersion;
 const next = await api('/api/state');
 if (version > playedVersion) {
  playedVersion = version;
  renderPlayed(next.roundPlayed ?? next.played ?? []);
 }
 return next;
}
async function refreshPlayed() {
 if (playedHistory.hidden || document.hidden || playedLoading) return;
 playedLoading = true;
 try { await readPublicState(); }
 catch { /* Keep the last visible list if the refresh fails. */ }
 finally { playedLoading = false; }
}
async function refresh({useAccountName = false} = {}){
 const version = ++refreshVersion;
 const [next, nextAccount] = await Promise.all([readPublicState(), api('/api/listener-account')]);
 const keys=[...new Set(slots.map(slot=>{const round=next.round+Number(slot.reserved);return tokens[`${round}:${slot.category}`]||tokens[round];}).filter(Boolean))];
 const savedTokens=Object.values(tokens).slice(-100);
 const [owned, history] = await Promise.all([
  Promise.all(keys.map(async token => [token, (await api('/api/mine', {token})).entry])),
  savedTokens.length ? api('/api/my-requests', {method:'POST', data:{tokens:savedTokens}}) : {entries:[]}
 ]);
 if (version !== refreshVersion) return;
 receipts = new Map(owned);
 myRequests = history.entries;
 if (nextAccount.signedIn && nextAccount.name) {
  if (nextAccount.method === 'passcode' || (!account.signedIn && (useAccountName || !lookupName()))) {
   $('name').value = nextAccount.name;
   safeSet('emupi-request-name', nextAccount.name);
  }
  if (!account.signedIn) {
   window.history.replaceState({requestScreen:true, currentSlot:activeSlot?.id, menuPage:activeMenuPage?.panel.id}, '');
   showRequestScreen(true);
  }
 }
 account = nextAccount;
 state=next;
 renderRequests();
 await refreshNameRequests();
}
function lookupName() {
 return $('name').value.normalize('NFKC').trim();
}
function renderGreeting() {
 const name = lookupName();
 const hour = Number(japanHour.format(new Date()));
 const salutation = hour < 5 || hour >= 18 ? 'こんばんは' : hour < 11 ? 'おはようございます' : 'こんにちは';
 const text = name ? `${salutation}、${name}さん` : '';
 if (greeting.textContent !== text) greeting.textContent = text;
}
async function refreshNameRequests(reportError = false) {
 const name = lookupName();
 const version = ++lookupVersion;
 if (!name) return;
 try {
  const {entries, occupiedSlots, round} = await api('/api/requests-by-name', {method:'POST', data:{name}});
  if (version !== lookupVersion || name !== lookupName()) return;
  loadedName = name;
  namedRequests = entries;
  if (occupiedSlots && state?.round === round) {
   const occupied = new Set(occupiedSlots.map(({round, category}) => duplicateKey(round, category, name)));
   const available = new Set(slots.map(slot => duplicateKey(state.round + Number(slot.reserved), slot.category, name))
    .filter(key => !occupied.has(key)));
   for (const slot of slots) if (available.has(slot.rejectedSubmission?.key)) slot.rejectedSubmission = null;
   const remaining = confirmedDuplicates.filter(key => !available.has(key));
   if (remaining.length !== confirmedDuplicates.length) {
    confirmedDuplicates = remaining;
    safeSet(duplicateStorageKey, JSON.stringify(confirmedDuplicates));
   }
  }
  if (entries.length) safeSet('emupi-request-name', name);
  if (state) renderRequests();
 } catch (error) {
  if (reportError && version === lookupVersion && name === lookupName()) message(error.message, true);
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
  if(slot.entry){const mine=slot.entry;part(slot,'.slot-song').textContent=mine.song;part(slot,'.slot-artist').textContent=mine.artist;renderStatusTag(part(slot,'.slot-status'), requestStatusKey(mine, slot.reserved));part(slot,'.slot-edit').closest('.edit-actions').hidden=!mine.songEditable;}
 }
 renderDuplicateSlots();
 renderUserCurrentRequests();
 renderGreeting();
 lock(busy);
 const archived = archive?.owner === historyOwner() ? archive.entries : [];
 const history = new Map([...archived, ...restored, ...myRequests, ...account.entries].map(entry => [entry.id, entry]));
 renderHistory([...history.values()].sort((a, b) => a.createdAt - b.createdAt));
 renderAccount();
}
function renderEntryOptions() {
 $('entry-line').hidden = entryMode !== 'login' || !account.enabled || account.signedIn;
 $('choose-registration-mode').hidden = entryMode === 'guest' && (!account.passcodeEnabled || account.signedIn);
}
function renderAccount() {
 renderEntryOptions();
 namePasscode.required = account.method === 'passcode';
 $('name-passcode-field').hidden = !namePasscode.required;
 $('manage-passcode').hidden = !account.passcodeEnabled || account.signedIn;
 $('manage-passcode-login').hidden = !account.passcodeEnabled || account.signedIn;
 $('line-start').hidden = !account.enabled || account.signedIn;
 const linked = new Set(account.entries.map(entry => entry.id));
 $('line-link').hidden = account.method !== 'line' || !myRequests.some(entry => !linked.has(entry.id));
 $('account-settings').hidden = ['manage-passcode', 'manage-passcode-login', 'line-start', 'line-link'].every(id => $(id).hidden);
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
 if(kind==='artist')candidates=[...new Map(items.filter(i=>classifyArtist(i.artist)===slot.category&&artistSearchNames(i).some(v=>normalize(v).includes(value))).map(i=>[i.artist,{label:i.artist}])).values()];
 else {const artistField = field(slot, 'artist');
  const artist = normalize(artistField.value);
  const artists = artistField.tagName === 'SELECT'
    ? new Set([artist])
    : new Set(items.filter(i => artistSearchNames(i).some(v => normalize(v) === artist)).map(i => normalize(i.artist)));candidates=items.filter(i=>classifyArtist(i.artist)===slot.category&&(!artist||artists.has(normalize(i.artist)))&&songSearchNames(i).some(v=>normalize(v).includes(value))).map(item=>({item}));}
 for(const candidate of candidates.slice(0,7)){const button=document.createElement('button');button.type='button';if (candidate.item) {
  const song = document.createElement('strong');
  song.textContent = candidate.item.song;
  const artist = document.createElement('span');
  artist.className = 'history-artist';
  artist.textContent = candidate.item.artist;
  button.append(song, artist);
 } else button.textContent = candidate.label;
 button.onclick=()=>{slot.draftRound??=slot.round;input.value=kind==='artist'?candidate.label:candidate.item.song;if(kind==='song'&&!field(slot,'artist').value)field(slot,'artist').value=candidate.item.artist;box.hidden=true;input.setAttribute('aria-expanded','false');lock(busy);input.focus();};box.append(button);}
 box.hidden=!box.children.length;input.setAttribute('aria-expanded',String(!box.hidden));
}
function stopEditing(slot) {
 slot.editing = null;
 slot.draftRound = null;
 const form = part(slot, '.slot-form');
 form.reset();
 form.hidden = !!slot.entry;
 part(slot, '.slot-receipt').hidden = !slot.entry;
 part(slot, '.slot-submit').textContent = slot.reserved ? '予約する' : 'リクエスト';
 part(slot, '.slot-cancel').hidden = true;
 hideSuggestions();
}
function nameFeedback(text, error = false) {
 const node = $('name-feedback');
 node.hidden = !text;
 node.textContent = text;
 node.classList.toggle('danger', error);
}
$('cancel-name').onclick = () => {
 if (window.history.state?.directMenuPage) goToRequestTop();
 else window.history.back();
};
newName.addEventListener('input', () => nameFeedback(''));
$('name-form').onsubmit = async event => {
 event.preventDefault();
 const name = newName.value.normalize('NFKC').trim();
 if (busy || $('request-screen').hidden || !name || name === lookupName()) return;
 const editable = slots.filter(slot => slot.entry?.editable);
 const ownedTokens = editable.map(slot => slot.token).filter(Boolean);
 lock(true);
 nameFeedback('');
 try {
  if (account.method === 'passcode') {
   await api('/api/passcode/rename', {method:'POST', data:{name, passcode:namePasscode.value}});
   namePasscode.value = '';
  } else {
   if (await requiresPasscode(name)) {
    nameFeedback('この名前にはパスコードが設定されています。別の名前を入力してください。', true);
    return;
   }
   if (editable.length) {
    await api('/api/mine', {method: 'PATCH', data: {action: 'renameAll', tokens: ownedTokens, account: editable.some(slot => !slot.token), name}});
   }
  }
  $('name').value = newName.value = name;
  safeSet('emupi-request-name', name);
  safeSet(rememberedNameKey, name);
  renderGreeting();
  if (state) renderRequests();
  nameFeedback('名前を変更しました。');
  try { await refresh(); } catch (error) { message(error.message, true); }
 } catch (error) {
  nameFeedback(error.message, true);
 } finally {
  lock(false);
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
    feedback(slot, '曲を変更しました。', false);
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
    if (activeSlot === slot) closeSlot();
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
  part(slot, '.slot-submit').textContent = '変更する';
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
const logoutConfirmation = $('logout-confirmation');
$('request-logout').onclick = () => {
 if (busy || logoutConfirmation.open) return;
 logoutConfirmation.returnValue = '';
 logoutConfirmation.showModal();
};
logoutConfirmation.addEventListener('keydown', event => {
 if (event.key === 'Escape') event.stopPropagation();
});
logoutConfirmation.addEventListener('close', async () => {
 if (logoutConfirmation.returnValue !== 'logout' || busy) return;
 lock(true);
 try {
  await api('/auth/line/logout', {method:'POST', data:{}});
  closeMenu();
  archive = null;
  const lastName = lookupName();
  ++lookupVersion;
  $('name').value = '';
  entryName.value = lastName;
  safeSet(rememberedNameKey, lastName);
  safeSet('emupi-request-name', '');
  setEntryMode('welcome');
  for (const slot of slots) {
   stopEditing(slot);
   feedback(slot, '');
  }
  $('my-history').open = false;
  $('account-settings').open = false;
  $('line-feedback').textContent = '';
  $('entry-line-feedback').hidden = true;
  const url = new URL(location.href);
  url.searchParams.delete('view');
  url.searchParams.delete('preview');
  window.history.replaceState(entryView('welcome'), '', url);
  showRequestScreen(false, true);
  logoutNotice.textContent = 'ログアウトしました。';
  logoutNoticeTimer = setTimeout(clearLogoutNotice, 3000);
  await refresh();
 } catch (error) {
  message(error.message, true);
 } finally {
  lock(false);
 }
});
const pageUrl = new URL(location.href);
const lineConnected = pageUrl.searchParams.get('line') === 'connected';
if (pageUrl.searchParams.has('line')) {
 $('account-settings').open = true;
 const notice = lineConnected ? 'LINEでログインしました。' : 'LINEでログインできませんでした。もう一度お試しください。';
 $('line-feedback').textContent = notice;
 $('entry-line-feedback').textContent = notice;
 $('entry-line-feedback').hidden = false;
 pageUrl.searchParams.delete('line');
 window.history.replaceState(window.history.state, '', pageUrl);
}
lock(false);
document.addEventListener('click',event=>{if(!event.target.closest('.sug-wrap'))hideSuggestions();});
try {
 await refresh({useAccountName:lineConnected});
 if (hasSavedName && $('request-screen').hidden) {
  const name = lookupName();
  const needsPasscode = !account.signedIn && await requiresPasscode(name);
  entryBusy = false;
  if (needsPasscode) promptForPasscode(name);
  else {
   window.history.replaceState({requestScreen:true}, '');
   showRequestScreen(true);
  }
 }
 if ($('request-screen').hidden && $('entry-screen').hidden) showRequestScreen(false);
 if (account.needsRecovery) {
  const {linked} = await api('/api/listener-account', {method:'POST', data:{}});
  if (linked) await refresh();
 }
 items = (await api('/api/suggestions')).items;
} catch (error) {
 message(error.message, true);
} finally {
 if ($('request-screen').hidden && $('entry-screen').hidden) showRequestScreen(false);
 entryBusy = false;
 updateEntryButton();
}
