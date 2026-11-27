import { artistSearchNames, songSearchNames } from './suggestion-readings.mjs?v=hangul';
import { closeMenu } from './site-menu.mjs?layout=keep-menu';
import { classifyArtist, categoryLabel } from './categories.mjs';
import { api, $, message, safeGet, safeSet, normalize } from './common.mjs';
import { korean, t, listenerError, localizeListenerPage } from './listener-language.mjs?v=song-details-dialog';
import { setupPocochaGlossary } from './pococha-glossary.mjs?v=glossary-fan-mark-copy-step';
import { showGlossaryGuide } from './glossary-guide.mjs?v=glossary-fan-mark-copy-step';
const totalTracks = count => korean ? `총 ${count}곡` : `全${count}曲`;
const languageView = history.state?.restoreLanguageView ? history.state : null;
localizeListenerPage();
const restoreGlossaryPosition = setupPocochaGlossary($('pococha-glossary'), korean);
const notesButton = $('request-notes-toggle');
notesButton.onclick = () => {
 const notes = $('request-notes');
 notes.hidden = !notes.hidden;
 notesButton.setAttribute('aria-expanded', String(!notes.hidden));
};
let pressedRow;
let pressedPointer;
let pressReleaseTimer;

function clearRowPress() {
 clearTimeout(pressReleaseTimer);
 pressedRow?.removeAttribute('data-row-pressed');
 pressedRow = null;
 pressedPointer = null;
}

document.addEventListener('pointerdown', event => {
 if (!event.isPrimary || event.button !== 0) return;
 clearRowPress();
 const independent = event.target.closest('button, a');
 const songRow = event.target.closest('.song-detail-row');
 const control = songRow && (!independent || independent.matches('.song-detail-trigger'))
  ? songRow
  : event.target.closest('.slot-overview-open, .request-menu-link, .playable-browse button');
 if (!control || control.matches(':disabled') || control.closest('[inert]')) return;
 const row = control.closest('.slot-overview-row') || control;
 pressedRow = row;
 pressedPointer = event.pointerId;
 row.setAttribute('data-row-pressed', '');
});
document.addEventListener('pointerup', event => {
 if (event.pointerId !== pressedPointer) return;
 // Keep fast taps visible for a frame without delaying navigation.
 pressReleaseTimer = setTimeout(clearRowPress, 100);
});
document.addEventListener('pointercancel', event => {
 if (event.pointerId === pressedPointer) clearRowPress();
});
for (const event of ['popstate', 'pagehide', 'pageshow', 'blur']) {
 window.addEventListener(event, clearRowPress);
}

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
 const openButton = $(`open-${root.id}`);
 return {root, id:root.id, category:root.dataset.category, reserved:root.dataset.reserved === 'true',
  entry:null, token:null, round:null, draftRound:null, overview:openButton.parentElement, openButton, detail:$(openButton.getAttribute('aria-controls'))};
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
function renderArtistLink(container, artist) {
 container.replaceChildren();
 if (!artist) return;
 const link = document.createElement('a');
 const url = new URL(location.href);
 url.searchParams.delete('preview');
 url.searchParams.set('view', 'playable-songs');
 url.searchParams.set('artist', artist);
 link.className = 'artist-link';
 link.href = url.href;
 link.textContent = artist;
 if (korean && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(artist)) link.lang = 'ja';
 container.append(link);
}
function renderSongIdentity(title, subtitle, song, artist, link = true) {
 title.classList.toggle('song-identity-title', Boolean(artist));
 subtitle.classList.add('song-identity-artist');
 title.textContent = song;
 if (korean) {
  title.lang = artist && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(song) ? 'ja' : '';
  subtitle.lang = artist && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(artist) ? 'ja' : '';
 }
 if (link) renderArtistLink(subtitle, artist);
 else subtitle.textContent = artist;
}
for (const slot of slots) {
 const receipt = part(slot, '.slot-receipt');
 const summary = document.createElement('div');
 summary.className = 'receipt-summary';
 const identity = document.createElement('div');
 identity.append(part(slot, '.slot-song'), part(slot, '.slot-artist'));
 const status = part(slot, '.slot-status');
 status.onclick = () => showRequestStatus(status.dataset.statusTag, slot.entry);
 summary.append(jacket(slot.category, 'slot-overview-art', 76), identity, status);
 receipt.prepend(summary);
}
const userCurrentList = $('user-current-list');
const userCurrentRows = currentSlots.map(slot => {
 const row = slot.overview.cloneNode(true);
 const openButton = row.querySelector('.slot-overview-open');
 openButton.removeAttribute('id');
 row.classList.remove('is-empty');
 row.hidden = true;
 userCurrentList.append(row);
 openButton.onclick = () => {
  if (busy) return;
  closeMenu();
  const method = activeSlot || activeMenuPage ? 'replaceState' : 'pushState';
  window.history[method]({requestScreen:true, currentSlot:slot.id}, '');
  showMenuPage(null);
  showSlot(slot.id, true);
 };
 return {slot, row, openButton};
});
function renderUserCurrentRequests() {
 let count = 0;
 for (const {slot, row, openButton} of userCurrentRows) {
  const entry = slot.entry;
  row.hidden = !entry || !['pending', 'selected'].includes(entry.status);
  if (row.hidden) continue;
  count++;
  const artist = row.querySelector('.slot-overview-song');
  renderSongIdentity(row.querySelector('strong'), artist, entry.song, entry.artist);
  openButton.setAttribute('aria-label', entry.song);
  artist.hidden = !entry.artist;
  renderStatusTag(row.querySelector('.slot-overview-status'), requestStatusKey(entry));
 }
 userCurrentList.hidden = count === 0;
 $('user-current-empty').hidden = count !== 0;
}
const reservation = $('next-reservation');
let activeSlot = null;
const requestStatusLabels = {unrequested:t('未リクエスト'), submitted:t('リクエスト済み'), reserved:t('予約済み'), temporary:t('一時保留'), pending:t('抽選待ち'), selected:t('当選'), done:t('当選済み'), challenged:t('チャレンジ'), skipped:t('見送り'), deferred:t('持ち越し'), removed:t('取り下げ済み')};
const requestStatusDescriptions = {
 unrequested:t('このカテゴリにはまだリクエストしていません。'),
 submitted:t('このカテゴリのリクエストを受け付けました。'),
 reserved:t('次の抽選枠にリクエストを予約しています。今の抽選枠の曲の対応がすべて終わると、抽選対象になります。'),
 temporary:t('配信側で一時保留にしたため、いまは抽選対象に入りません。'),
 pending:t('受付が完了し、抽選で選ばれるのを待っています。'),
 selected:t('この曲が抽選で選ばれました。'),
 done:t('この曲は抽選で選ばれ、歌唱が済んでいます。'),
 challenged:t('歌える曲ではありませんでしたが、配信で試しに歌いました。'),
 skipped:t('抽選で選ばれたあと、今回は歌わずに見送りとなりました。'),
 deferred:t('この曲は次の配信で抽選対象に戻ります。'),
 removed:t('この曲のリクエストは取り下げられました。'),
};
function describeRequestStatus(key, entry) {
 if (key !== 'deferred') return requestStatusDescriptions[key];
 const next = requestStatusDescriptions.deferred;
 if (entry?.deferReason === 'sung') return t('この配信ですでに歌った曲のため、今回は抽選対象から外れています。') + next;
 if (entry?.deferReason === 'manual') return t('配信側で次の配信へ持ち越す操作をしました。') + next;
 if (entry?.deferReason === 'unknown') {
  const reason = {unknown:t('曲を知らない'), no_audio:t('歌唱に使う音源がない')}[entry.unavailableReason];
  return (reason ? (korean ? `「${reason}」이라는 이유로 현재 추첨 대상에서 제외됐어요. ` : `「${reason}」という理由で、今回は抽選対象から外れています。`) : t('歌えない理由が登録されたため、今回は抽選対象から外れています。')) + next;
 }
 return next;
}
function showRequestStatus(key, entry) {
 const description = describeRequestStatus(key, entry);
 if (!description) return;
 showListenerExplanation(requestStatusLabels[key], description);
}
function showListenerExplanation(title, description) {
 $('request-status-title').textContent = title;
 $('request-status-description').textContent = description;
 $('request-status-dialog').showModal();
}
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
 renderSongIdentity(title, artist, slot.entry?.song || t(categoryLabel(slot.category)), slot.entry?.artist);
 slot.openButton.setAttribute('aria-label', title.textContent);
 artist.hidden = !artist.textContent;
 category.hidden = !slot.entry;
 if (slot.entry) renderStatusTag(status, requestStatusKey(slot.entry, slot.reserved));
 else if (empty && slot.reserved) {
  delete status.dataset.statusTag;
  status.textContent = t('次の抽選枠に予約する');
 } else renderStatusTag(status, empty ? 'unrequested' : slot.reserved ? 'reserved' : 'submitted');
 slot.overview.classList.toggle('is-empty', empty);
}
function showSlot(id, focus = false) {
 const previous = activeSlot;
 activeSlot = slots.find(slot => slot.id === id && (!slot.reserved || !reservation.hidden)) || null;
 if (previous !== activeSlot) $('request-status-dialog').close();
 if (activeSlot?.reserved) reservation.open = true;
 $('request-overview').hidden = Boolean(activeSlot);
 $('request-detail').hidden = !activeSlot;
 $('reservation-detail-label').hidden = !activeSlot?.reserved;
 for (const slot of slots) slot.detail.hidden = slot !== activeSlot;
 const previousRow = previous && (!previous.reserved || !reservation.hidden) && previous.openButton;
 if (previous !== activeSlot) previous?.favoriteDialog?.close();
 if (focus) (activeSlot?.detail || previousRow || $('request-title')).focus();
}
function closeSlot() {
 if (activeSlot) window.history.back();
}
for (const slot of slots) {
 slot.openButton.onclick = () => {
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
const glossaryTerm = initialView === 'pococha-glossary' ? initialParams.get('term') : null;
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
   const artist = page.panel.id === 'playable-songs' && initialParams.get('artist')?.trim();
   const artistPage = artist ? {playableCategory:classifyArtist(artist), playableView:'artists', playableArtist:artist} : {};
   window.history.replaceState({...window.history.state, ...artistPage, menuPage:page.panel.id, directMenuPage:true}, '');
   Promise.resolve(showMenuPage(page.panel.id, true)).finally(() => {
    delete document.documentElement.dataset.carryMenu;
   });
   return;
  }
 }
 delete document.documentElement.dataset.carryMenu;
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
 entryTitle.textContent = welcome ? welcomeTitle : login ? t('ログイン') : t('はじめての方');
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
 $('choose-name-login').textContent = mode === 'name-login' ? t('パスコードでログイン') : t('名前だけでログイン');
 $('choose-registration-mode').textContent = guest ? t('パスコードを設定して始める') : t('名前だけで始める');
 entryPasscode.required = usesPasscode(mode);
 entryPasscode.value = '';
 entryPasscode.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
 $('enter-request').textContent = guest ? t('名前だけで始める') : mode === 'register' ? t('パスコードを設定して始める') : t('ログイン');
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
 passcodeFeedback(t('この名前にはパスコードが設定されています。'));
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
   if (nameOnly) message(listenerError(error), true);
   else passcodeFeedback(listenerError(error));
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
  try { await refresh({useAccountName:true}); } catch (error) { message(listenerError(error), true); }
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
 if (panel.id === 'pococha-glossary' && glossaryTerm) showGlossaryGuide(glossaryTerm, korean, menuPageTitle);
 $('favorite-feedback').hidden = true;
 menuPage.querySelector('.artist-favorite')?.remove();
 if (panel.id === 'playable-songs') showPlayableCategory(window.history.state);
 if (panel.id === 'playable-songs' || panel.id === 'played-history') loadFavorites();
 if (panel === nameSettings && activeMenuPage !== previous) {
  newName.value = lookupName();
  namePasscode.value = '';
  nameFeedback('');
 }
 if (focus) {
  window.scrollTo(0, 0);
  menuPageTitle.focus();
 }
 if (panel.id === 'pococha-glossary' && !glossaryTerm) restoreGlossaryPosition?.();
 if (panel.id === 'my-history') return loadArchivedHistory();
 if (panel.id === 'favorites') return openFavorites();
 if (panel.id === 'played-history') return refreshPlayed();
 if (panel.id === 'playable-songs' && previous !== activeMenuPage) return refreshPlayable();
}
for (const {button,panel} of menuPages) {
 button.onclick = () => {
  if (activeMenuPage?.panel === panel && !(panel.id === 'pococha-glossary' && glossaryTerm)) {
   closeMenu();
   const {playableDepth = 0} = window.history.state || {};
   if (playableDepth) window.history.go(-(1 + playableDepth));
   else menuPageTitle.focus();
   return;
  }
  const url = new URL(location.href);
  url.searchParams.delete('preview');
  url.searchParams.delete('artist');
  url.searchParams.delete('term');
  url.searchParams.set('view', panel.id === nameSettings.id ? 'name-settings' : panel.id);
  try { sessionStorage.setItem('emupi-menu-destination', url.href); } catch {}
  location.assign(url);
 };
}
function goToRequestTop() {
 if (activeMenuPage && window.history.state?.directMenuPage) {
  const url = new URL(location.href);
  url.searchParams.delete('view');
  url.searchParams.delete('preview');
  url.searchParams.delete('artist');
  url.searchParams.delete('term');
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
 for (const button of document.querySelectorAll('.slot-cancel, .slot-edit, #save-name, #cancel-name, #line-link, #request-logout, .slot-overview-open')) button.disabled = busy;
 newName.readOnly = namePasscode.readOnly = busy;
 for (const slot of slots) part(slot, '.slot-submit').disabled = !canSubmit(slot);
 for (const slot of currentSlots) {
  slot.favoritePicker.hidden = Boolean(slot.entry || slot.editing);
  if (slot.favoritePicker.hidden) slot.favoriteDialog.close();
 }
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
 row.classList.add('song-detail-row');
 const title = document.createElement('button');
 title.type = 'button';
 title.className = 'song-detail-trigger';
 title.setAttribute('aria-haspopup', 'dialog');
 const subtitle = document.createElement('div');
 renderSongIdentity(title, subtitle, song, artist);
 title.onclick = () => openSongDetails(artist, song);
 row.onclick = event => {
  if (!event.target.closest('button, a')) title.click();
 };
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
  const interactive = list.id === 'played-list' && statusKey === 'challenged';
  const tag = document.createElement(interactive ? 'button' : 'span');
  if (interactive) {
   tag.type = 'button';
   tag.setAttribute('aria-haspopup', 'dialog');
   tag.onclick = () => showRequestStatus(statusKey);
  }
  renderStatusTag(tag, statusKey);
  tag.className = 'history-tag';
  if (list.id === 'played-list') {
   const titleLine = document.createElement('div');
   titleLine.className = 'played-history-title';
   title.before(titleLine);
   titleLine.append(title, tag);
  } else {
   identity.append(tag);
  }
 }
 if (category) row.append(jacket(category, 'history-art', 42));
 row.append(identity);
 if (['played-list', 'playable-track-list', 'favorite-track-list'].includes(list.id)) {
  row.classList.add('favorite-song-row');
  row.append(favoriteButton(favoriteSongKey(artist, song), song));
 }
 list.append(row);
}
const favoriteStorageKey = 'emupi-request-favorites';
const favoriteSongKey = (artist, song) => 'song:' + JSON.stringify([normalize(artist), normalize(song)]);
const songDetails = $('song-details-dialog');
function songRequestDraft(artist) {
 const slot = currentSlots.find(item => item.category === classifyArtist(artist));
 if (!state || !lookupName() || $('request-screen').hidden || !slot || hasSlotRequest(slot)) return null;
 const fieldArtist = field(slot, 'artist');
 const value = fieldArtist instanceof HTMLSelectElement
  ? [...fieldArtist.options].find(option => normalize(option.value) === normalize(artist))?.value
  : artist;
 return value ? {slot, value} : null;
}
function openSongDetails(artist, song) {
 renderSongIdentity($('song-details-title'), $('song-details-artist'), song, artist);
 $('song-details-art').replaceChildren(jacket(classifyArtist(artist), 'song-details-jacket', 64));
 const request = $('song-details-request');
 request.hidden = !songRequestDraft(artist);
 request.onclick = () => {
  const draft = songRequestDraft(artist);
  if (!draft || busy) {
   request.hidden = !draft;
   return;
  }
  const {slot, value} = draft;
  songDetails.close();
  const url = new URL(location.href);
  for (const key of ['view', 'category', 'artist', 'term', 'preview']) url.searchParams.delete(key);
  window.history.pushState({requestScreen:true, currentSlot:slot.id}, '', url);
  showMenuPage(null);
  showSlot(slot.id, true);
  slot.draftRound = slot.round;
  field(slot, 'artist').value = value;
  field(slot, 'song').value = song;
  hideSuggestions();
  lock(busy);
  window.scrollTo(0, 0);
 };
 $('song-details-favorite').replaceChildren(favoriteButton(favoriteSongKey(artist, song), song, true));
 $('song-details-feedback').textContent = '';
 songDetails.showModal();
 loadFavorites();
}
let favoriteState;
function favoritesForListener() {
 const owner = account.signedIn ? historyOwner() : 'browser';
 if (favoriteState?.owner === owner) return favoriteState;
 const current = {owner, synced:account.signedIn, keys:new Set(), pending:new Set(), ready:!account.signedIn, loading:false};
 if (!current.synced) {
  try { current.keys = new Set(JSON.parse(safeGet(favoriteStorageKey) || '[]')); } catch {}
 }
 favoriteState = current;
 return current;
}
function favoriteFeedback(text) {
 const feedback = $('favorite-feedback');
 feedback.textContent = text;
 feedback.hidden = !text;
}
function updateFavoriteButtons(current) {
 if (favoritesForListener() !== current) return;
 for (const button of document.querySelectorAll('[data-favorite-key]')) {
  const key = button.dataset.favoriteKey;
  const saved = current.keys.has(key);
  button.setAttribute('aria-pressed', String(saved));
  const label = button.querySelector('.song-details-favorite-label');
  if (label) label.textContent = t(saved ? 'お気に入りから外す' : 'お気に入りに追加');
  button.disabled = !current.ready || current.pending.has(key);
 }
}
async function loadFavorites() {
 const current = favoritesForListener();
 updateFavoriteButtons(current);
 if (current.ready || current.loading) return;
 current.loading = true;
 try {
  const {favorites} = await api('/api/listener-favorites');
  current.keys = new Set(favorites);
  current.ready = true;
 } catch {
  if (favoritesForListener() === current) favoriteFeedback(t('お気に入りを読み込めませんでした。'));
 } finally {
  current.loading = false;
  updateFavoriteButtons(current);
 }
}
function favoriteButton(key, name, withLabel = false) {
 const button = document.createElement('button');
 button.type = 'button';
 button.className = 'favorite-star';
 button.dataset.favoriteKey = key;
 button.setAttribute('aria-label', korean ? name + ' 즐겨찾기' : name + 'のお気に入り');
 button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z"/></svg>';
 const initial = favoritesForListener();
 if (withLabel) {
  const label = document.createElement('span');
  label.className = 'song-details-favorite-label';
  label.textContent = t(initial.keys.has(key) ? 'お気に入りから外す' : 'お気に入りに追加');
  button.removeAttribute('aria-label');
  button.classList.add('song-details-favorite-button');
  button.append(label);
 }
 button.setAttribute('aria-pressed', String(initial.keys.has(key)));
 button.disabled = !initial.ready || initial.pending.has(key);
 button.onclick = async () => {
  const current = favoritesForListener();
  if (!current.ready || current.pending.has(key)) return;
  const saved = !current.keys.has(key);
  const keys = new Set(current.keys);
  if (saved) keys.add(key);
  else keys.delete(key);
  current.pending.add(key);
  updateFavoriteButtons(current);
  favoriteFeedback('');
  if (withLabel) $('song-details-feedback').textContent = '';
  try {
   if (current.synced) {
    await api('/api/listener-favorites', {method:'POST', data:{key,saved}});
   } else {
    if (!safeSet(favoriteStorageKey, JSON.stringify([...keys]))) throw new Error();
   }
   const firstSong = saved && key.startsWith('song:') && ![...current.keys].some(item => item.startsWith('song:'));
   if (saved) current.keys.add(key);
   else current.keys.delete(key);
   if (firstSong && favoritesForListener() === current) {
    showListenerExplanation(t('お気に入りに追加しました'), $('user-menu-toggle').hidden
     ? t('利用を始めると、右上の人型メニューの「お気に入り」から確認できます。')
     : t('右上の人型メニューの「お気に入り」から確認できます。'));
   }
   if (!$('favorites').hidden && favoritesForListener() === current) renderFavorites(current);
  } catch {
   if (favoritesForListener() === current) {
    const error = t('お気に入りを変更できませんでした。');
    if (withLabel && songDetails.open) $('song-details-feedback').textContent = error;
    else favoriteFeedback(error);
   }
  } finally {
   current.pending.delete(key);
   updateFavoriteButtons(current);
  }
 };
 return button;
}
async function openFavorites() {
 const current = favoritesForListener();
 await loadFavorites();
 if (!current.ready || $('favorites').hidden || favoritesForListener() !== current) return;
 if (current.keys.size && !playableSongs) {
  try { await loadFavoriteRepertoire(); }
  catch {
   if (!$('favorites').hidden) favoriteFeedback(t('お気に入りの曲名を読み込めませんでした。'));
  }
 }
 if (!$('favorites').hidden && favoritesForListener() === current) renderFavorites(current);
}
async function loadFavoriteRepertoire() {
 if (!playableSongs) {
  const {songs} = await api('/api/repertoire');
  playableSongs = songs.sort((a,b) => songOrdering.compare(a.artist,b.artist) || songOrdering.compare(a.song,b.song));
 }
 return playableSongs;
}
for (const slot of currentSlots) {
 const picker = document.createElement('button');
 picker.type = 'button';
 picker.className = 'slot-favorite-picker';
 picker.setAttribute('aria-haspopup', 'dialog');
 const icon = document.createElement('span');
 icon.setAttribute('aria-hidden', 'true');
 icon.textContent = '☆';
 picker.append(icon, t('お気に入りから選ぶ'));
 const dialog = document.createElement('dialog');
 dialog.className = 'listener-dialog slot-favorite-dialog';
 const heading = document.createElement('h2');
 heading.id = slot.id + '-favorites-heading';
 heading.textContent = t('お気に入りから選ぶ');
 heading.tabIndex = -1;
 heading.autofocus = true;
 dialog.setAttribute('aria-labelledby', heading.id);
 const close = document.createElement('button');
 close.type = 'button';
 close.className = 'secondary';
 close.textContent = t('閉じる');
 close.onclick = () => dialog.close();
 const choices = document.createElement('div');
 choices.className = 'playable-browse';
 const status = document.createElement('p');
 status.className = 'small muted';
 status.setAttribute('role', 'status');
 const actions = document.createElement('div');
 actions.className = 'buttons';
 actions.append(close);
 dialog.append(heading, status, choices, actions);
 part(slot, '.slot-actions').before(picker);
 slot.detail.append(dialog);
 slot.favoritePicker = picker;
 slot.favoriteDialog = dialog;
 let opening = 0;
 picker.addEventListener('click', async () => {
  const version = ++opening;
  choices.replaceChildren();
  status.textContent = t('読み込み中…');
  dialog.showModal();
  const favorites = favoritesForListener();
  await loadFavorites();
  try {
   if (!favorites.ready) throw new Error();
   const songs = favorites.keys.size ? await loadFavoriteRepertoire() : [];
   if (!dialog.open || version !== opening || favoritesForListener() !== favorites) return;
   const artistField = field(slot, 'artist');
   for (const {artist, song, category} of songs) {
    if (category !== slot.category || !favorites.keys.has(favoriteSongKey(artist, song))) continue;
    if (artistField instanceof HTMLSelectElement && ![...artistField.options].some(option => option.value === artist)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    const title = document.createElement('span');
    const subtitle = document.createElement('span');
    renderSongIdentity(title, subtitle, song, artist, false);
    button.append(title, subtitle);
    button.onclick = () => {
     if (busy || slot.entry || slot.editing) return;
     slot.draftRound ??= slot.round;
     artistField.value = artist;
     field(slot, 'song').value = song;
     hideSuggestions();
     dialog.close();
     lock(busy);
    };
    choices.append(button);
   }
   status.textContent = choices.childElementCount ? '' : t('このカテゴリのお気に入りの曲はありません。');
  } catch {
   if (version === opening) status.textContent = t('お気に入りを読み込めませんでした。');
  }
 });
}
function renderFavorites(current) {
 const artists = $('favorite-artist-list');
 const tracks = $('favorite-track-list');
 artists.replaceChildren();
 tracks.replaceChildren();
 const names = new Map((playableSongs || []).map(({artist}) => [normalize(artist), artist]));
 const songs = new Map((playableSongs || []).map(song => [favoriteSongKey(song.artist, song.song), song]));
 for (const key of current.keys) {
  if (typeof key !== 'string') continue;
  if (key.startsWith('artist:')) {
   const name = names.get(key.slice(7)) || key.slice(7);
   const row = document.createElement('li');
   row.className = 'favorite-song-row';
   const identity = document.createElement('div');
   renderArtistLink(identity, name);
   row.append(identity);
   row.append(favoriteButton(key, name));
   artists.append(row);
  } else if (key.startsWith('song:')) {
   let identity;
   try { identity = JSON.parse(key.slice(5)); } catch { continue; }
   if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(value => typeof value === 'string')) continue;
   const [artist, song] = identity;
   const metadata = songs.get(key);
   historyRow(tracks, metadata?.song || song, metadata?.artist || names.get(artist) || artist, undefined, undefined, null);
  }
 }
 $('favorite-artists').hidden = !artists.childElementCount;
 $('favorite-tracks').hidden = !tracks.childElementCount;
 $('favorite-empty').hidden = Boolean(artists.childElementCount || tracks.childElementCount);
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
  current.error = listenerError(error);
 } finally {
  current.loading = false;
  if (archive === current && historyOwner() === owner && state) renderRequests();
 }
}
$('my-history-more').onclick = () => loadArchivedHistory(true);

function renderHistory(myRequests){
 const current = archive?.owner === historyOwner() ? archive : null;
 $('my-history-empty').hidden = Boolean(myRequests.length || current?.loading || current?.error);
 $('my-history-count').textContent = myRequests.length ? `${myRequests.length}${korean ? '건' : '件'}${current?.next ? (korean ? ' 이상' : '以上') : ''}` : '';
 $('my-history-feedback').textContent = current?.loading ? t('履歴を読み込み中…') : current?.error || '';
 $('my-history-feedback').hidden = !$('my-history-feedback').textContent;
 $('my-history-more').hidden = !current?.next && !current?.error;
 $('my-history-more').disabled = Boolean(current?.loading);
 $('my-history-more').textContent = current?.error ? t('再読み込み') : t('もっと見る');
 $('my-history-list').replaceChildren();
 for(const entry of [...myRequests].reverse())historyRow($('my-history-list'),entry.song,entry.artist,`${t(categoryLabel(entry.category))} · ${entry.round>state.round?t('次の抽選枠への予約'):entry.round===state.round?t('今の抽選枠'):t('過去のリクエスト')}${entry.status!=='done'&&entry.playedThisSession? ' · ' + t('同じ曲はこの配信で歌唱済み') : ''}`,entry.createdAt, entry.category, requestStatusKey(entry, entry.round > state.round));
}
function renderPlayed(played) {
 $('played-total').textContent = totalTracks(played.length);
 $('played-total').hidden = false;
 $('played-count').textContent=played.length?`${played.length}${korean ? '곡' : '曲'}`:'';$('played-empty').hidden=!!played.length;$('played-list').replaceChildren();
 for (const entry of [...played].reverse()) {
  const challenged = entry.status === 'challenged';
  const label = challenged || entry.performedAt ? '' : (korean ? '노래 완료' : '歌唱済み');
  historyRow($('played-list'), entry.song, entry.artist, label, entry.performedAt,
   classifyArtist(entry.artist), challenged ? 'challenged' : undefined);
 }
}
const playable = $('playable-songs');
const playableCategories = $('playable-categories');
const playableGroups = $('playable-groups');
const playableSearch = $('playable-search');
const playableSearchClear = $('playable-search-clear');
const playableSearchField = playableSearch.parentElement;
const playableCategoryButtons = [...playableCategories.querySelectorAll('button')];
let playableSongs = null;
function showPlayableCategory({playableCategory: category, playableView: view, playableArtist: artist, playableSearchValue = ''} = {}) {
 playableSearch.value = playableSearchValue;
 const selected = playableCategoryButtons.find(button => button.dataset.playableCategory === category);
 const browsing = Boolean(selected && view);
 const searchLabel = view === 'artists' && !artist ? t('アーティスト名で検索') : t('曲名・アーティスト名で検索');
 playableSearch.placeholder = searchLabel;
 playableSearch.setAttribute('aria-label', searchLabel);
 for (const button of playableCategoryButtons) {
  $(`playable-${button.dataset.playableCategory}-detail`).hidden = button !== selected;
 }
 if (browsing) {
  menuPageTitle.textContent = artist || (view === 'artists' ? t('アーティスト') : t('曲'));
  if (artist) {
   const star = favoriteButton('artist:' + normalize(artist), artist);
   star.classList.add('artist-favorite');
   menuPageTitle.after(star);
  }
 }
 renderPlayableResults();
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
playableSearch.addEventListener('input', renderPlayableResults);
playableSearchClear.addEventListener('click', () => {
 playableSearch.value = '';
 playableSearch.focus();
 renderPlayableResults();
});
playableSearchField.addEventListener('submit', event => {
 event.preventDefault();
 playableSearch.blur();
});
function renderPlayableResults() {
 playableSearchClear.hidden = !playableSearch.value;
 const route = window.history.state || {};
 const {playableCategory: category, playableView: view, playableArtist: artist} = route;
 const value = normalize(playableSearch.value);
 const query = artist && value === normalize(artist) ? '' : value;
 const browsing = Boolean(category && view);
 playableCategories.hidden = Boolean(category || query);
 playableGroups.hidden = !category || browsing || Boolean(query);
 $('playable-results').hidden = !browsing && !query;
 const artists = $('playable-artists');
 const tracks = $('playable-track-list');
 const artistList = view === 'artists' && !artist;
 const songs = (playableSongs || []).filter(song => (!category || song.category === category) && (!artist || song.artist === artist));
 const matchedArtists = new Map();
 const matchedTracks = [];
 for (const song of songs) {
  const artistMatches = query && artistSearchNames(song).some(name => normalize(name).includes(query));
  if ((artistList && !query) || (!artist && artistMatches)) {
   matchedArtists.set(song.artist, song.category);
  }
  if (!artistList && (!query || (artist && artistMatches) || songSearchNames(song).some(name => normalize(name).includes(query)))) {
   matchedTracks.push(song);
  }
 }
 const total = $('playable-total');
 total.hidden = !playableSongs;
 const counts = [];
 if (matchedArtists.size || artistList) counts.push(`${matchedArtists.size}${korean ? '팀' : '組'}`);
 if (matchedTracks.length || !counts.length) counts.push(`${matchedTracks.length}${korean ? '곡' : '曲'}`);
 total.textContent = query ? (korean ? `검색 결과 ${counts.join(' · ')}` : `検索結果 ${counts.join('・')}`) : totalTracks(songs.length);
 if (!browsing && !query) return;
 artists.hidden = matchedArtists.size === 0;
 tracks.hidden = matchedTracks.length === 0;
 artists.replaceChildren();
 tracks.replaceChildren();
 const empty = $('playable-empty');
 empty.hidden = !playableSongs || matchedArtists.size > 0 || matchedTracks.length > 0;
 empty.textContent = query ? t('該当する結果がありません。') : t('まだ曲がありません。');
 for (const [name, artistCategory] of matchedArtists) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.onclick = () => {
   window.history.replaceState({...route, playableSearchValue:playableSearch.value}, '');
   navigatePlayable({playableCategory:artistCategory, playableView:'artists', playableArtist:name, playableSearchValue:query ? name : ''});
  };
  artists.append(button);
 }
 for (const song of matchedTracks) historyRow(tracks, song.song, song.artist, undefined, undefined, null);
}
const songOrdering = new Intl.Collator('ja');
let playableLoading = false;
async function refreshPlayable() {
 if (playable.hidden || document.hidden || playableLoading) return;
 playableLoading = true;
 const feedback = $('playable-feedback');
 if (!playableSongs) {
  feedback.textContent = t('読み込み中…');
  feedback.hidden = false;
 }
 try {
  const {songs} = await api('/api/repertoire');
  songs.sort((a,b) => songOrdering.compare(a.artist,b.artist) || songOrdering.compare(a.song,b.song));
  playableSongs = songs;
  if (!playable.hidden) renderPlayableResults();
  feedback.hidden = true;
 } catch (error) {
  feedback.textContent = listenerError(error);
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
 const wasSignedIn = account.signedIn;
 account = nextAccount;
 if (nextAccount.signedIn && nextAccount.name) {
  if (nextAccount.method === 'passcode' || (!wasSignedIn && (useAccountName || !lookupName()))) {
   $('name').value = nextAccount.name;
   safeSet('emupi-request-name', nextAccount.name);
  }
  if (!wasSignedIn) {
   window.history.replaceState({requestScreen:true, currentSlot:activeSlot?.id, menuPage:activeMenuPage?.panel.id}, '');
   showRequestScreen(true);
  }
 }
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
 const salutation = hour < 5 || hour >= 18 ? t('こんばんは') : hour < 11 ? t('おはようございます') : t('こんにちは');
 const text = name ? (korean ? `${name}님, 안녕하세요` : `${salutation}、${name}さん`) : '';
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
  if (reportError && version === lookupVersion && name === lookupName()) message(listenerError(error), true);
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
  if(slot.entry){const mine=slot.entry;renderSongIdentity(part(slot,'.slot-song'),part(slot,'.slot-artist'),mine.song,mine.artist);renderStatusTag(part(slot,'.slot-status'), requestStatusKey(mine, slot.reserved));part(slot,'.slot-edit').closest('.edit-actions').hidden=!mine.songEditable;}
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
 const status = await api(`/api/song-status?${new URLSearchParams({artist:data.artist,song:data.song})}`);
 if (!status.unknownAt && status.listed !== false) return true;
 let description = t('歌唱記録がまだない曲です。このままリクエストしますか？');
 if (status.unknownAt) {
  const formatter = new Intl.DateTimeFormat(korean ? 'ko-KR' : 'ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const reasons = status.reasons || [{reason:'unknown',at:status.unknownAt}];
  description = reasons.map(({reason, at}) => reason === 'no_audio'
   ? (korean ? `${formatter.format(at)} 기준으로 이 곡의 음원이 없었어요.` : `${formatter.format(at)}時点では、この曲の音源がありませんでした。`)
   : (korean ? `${formatter.format(at)} 기준으로 えむぴー가 이 곡을 아직 익히지 못했어요.` : `${formatter.format(at)}時点では、えむぴーがこの曲をまだ覚えていませんでした。`)
  ).join('\n') + '\n' + t('それでもリクエストしますか？');
 }
 $('unknown-description').textContent = description;
 const dialog = $('unknown-warning');
 dialog.returnValue = '';
 const confirmed = await new Promise(resolve => {
  dialog.addEventListener('close', () => resolve(dialog.returnValue === 'request'), {once:true});
  dialog.showModal();
 });
 if (confirmed && status.unknownAt) data.unknownAcknowledgedAt = status.unknownAt;
 return confirmed;
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
  const artist = document.createElement('span');
  renderSongIdentity(song, artist, candidate.item.song, candidate.item.artist, false);
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
 part(slot, '.slot-submit').textContent = slot.reserved ? t('次の抽選枠に予約する') : t('リクエストする');
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
    nameFeedback(t('この名前にはパスコードが設定されています。別の名前を入力してください。'), true);
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
  nameFeedback(t('名前を変更しました。'));
  try { await refresh(); } catch (error) { message(listenerError(error), true); }
 } catch (error) {
  nameFeedback(listenerError(error), true);
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
 rejected.textContent = slot.reserved ? t('すでに予約があるため、今入力した曲は予約されませんでした。') : t('すでにリクエストがあるため、今入力した曲は送信されませんでした。');
 const status = document.createElement('p');
 status.className = 'duplicate-label';
 status.textContent = slot.reserved ? t('このカテゴリは次の抽選枠に予約済みです。') : t('このカテゴリはリクエスト済みです。');
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
    feedback(slot, t('曲を変更しました。'), false);
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
   feedback(slot, listenerError(error));
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
  part(slot, '.slot-submit').textContent = t('変更する');
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
  status.textContent = listenerError(error);
 } finally {
  lock(false);
  renderAccount();
 }
}
$('line-link').onclick = () => accountAction('/api/listener-account', {tokens: Object.values(tokens).slice(-100)},
 result => result.linked ? (korean ? `신청곡 ${result.linked}건을 연동했어요.` : `${result.linked}件のリクエストを連携しました。`) : t('新しく連携できるリクエストはありません。'));
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
  logoutNotice.textContent = t('ログアウトしました。');
  logoutNoticeTimer = setTimeout(clearLogoutNotice, 3000);
  await refresh();
 } catch (error) {
  message(listenerError(error), true);
 } finally {
  lock(false);
 }
});
const pageUrl = new URL(location.href);
const lineConnected = pageUrl.searchParams.get('line') === 'connected';
if (pageUrl.searchParams.has('line')) {
 $('account-settings').open = true;
 const notice = lineConnected ? t('LINEでログインしました。') : t('LINEでログインできませんでした。もう一度お試しください。');
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
 message(listenerError(error), true);
} finally {
 if ($('request-screen').hidden && $('entry-screen').hidden) showRequestScreen(false);
 entryBusy = false;
 if (languageView && languageView.requestScreen === !$('request-screen').hidden) {
  const {restoreLanguageView, ...route} = languageView;
  history.replaceState(route, '');
  if (!route.requestScreen && route.entryMode && (route.entryMode !== 'welcome' || entryMode === 'welcome')) setEntryMode(route.entryMode);
  showMenuPage(route.menuPage);
  if (route.requestScreen) showSlot(route.currentSlot);
 }
 updateEntryButton();
}
