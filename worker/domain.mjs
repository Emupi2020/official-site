import { categoryOf, classifyArtist, categoryLabel } from '../request/categories.mjs';
import { catalog } from '../request/catalog.mjs';

export class Problem extends Error {
  constructor(message, status = 400, code) { super(message); this.status = status; this.code = code; }
}
export const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・･._\-’']/g, '');
export const nameKey = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function text(value, label, max = 100) {
  if (typeof value !== 'string') throw new Problem(`${label}を入力してください。`);
  const clean = value.normalize('NFKC').trim();
  if (!clean || [...clean].length > max) throw new Problem(`${label}は1〜${max}文字で入力してください。`);
  if (/[\u0000-\u001f\u007f]|https?:\/\/|www\.|(.)\1{14,}/iu.test(clean)) throw new Problem('URLや無意味な連続文字は入力できません。');
  return clean;
}
export function songIdentity(artist, song, custom = []) {
  const a = normalize(artist), s = normalize(song);
  const item = [...catalog, ...custom].find(c => [c.artist, ...(c.artistAliases || [])].some(v => normalize(v) === a) && [c.song, ...(c.aliases || [])].some(v => normalize(v) === s));
  return item ? `${normalize(item.artist)}:${normalize(item.song)}` : `${a}:${s}`;
}
const hour = 60 * 60 * 1000;
const jstDay = now => new Date(now + 9 * hour).toISOString().slice(0, 10);
const sessionCutoffDay = now => jstDay(now - 15 * hour);
export function initialState(now = Date.now()) {
  return { round: 1, session: 1, sessionSwitchDate:sessionCutoffDay(now), open: true, entries: [], sung: [], held: [], unknown: {}, history: [], current: null, undo: null, suggestions: [], retentionDays: 30 };
}
export function rolloverSession(state, now = Date.now()) {
  const due = sessionCutoffDay(now);
  if (!state.sessionSwitchDate) {
    // Preserve the currently active session when an older save is first loaded.
    state.sessionSwitchDate = due;
    return true;
  }
  if (state.sessionSwitchDate >= due) return false;
  const current = state.entries.find(entry => entry.id === state.current);
  // A draw crossing the cutoff gets time to finish and display its result.
  const cutoff = Date.parse(due + 'T15:00:00+09:00');
  const recentWinner = current?.status === 'selected' || (current?.status === 'done' && current.autoDone);
  if (recentWinner && now < cutoff + 30_000 && now - current.drawnAt < 30_000) return false;
  if (current?.status === 'selected') {
    if (current.revealedAt) adminAction(state, {action:'done', id:current.id});
    else {
      current.status = 'pending';
      current.deferReason = null;
      delete current.drawnAt;
      delete current.manualPick;
    }
  }
  adminAction(state, {action:'session'}, now);
  state.sessionSwitchDate = due;
  return true;
}
function drawBlock(state, entry) {
  if (state.sung.includes(entry.songKey) && !entry.allowRepeat) return 'sung';
  if (state.held?.includes(entry.songKey) && !entry.retryHeld) return 'unknown';
  return null;
}
export function eligible(state, category = 'all') {
  return state.entries.filter(entry => entry.status === 'pending' && entry.round <= state.round
    && (category === 'all' || categoryOf(entry) === category) && !drawBlock(state, entry));
}
// Complete a round only after every active request has been handled.
function finishRounds(state, undoable = true) {
  const from = state.round;
  while (!eligible(state).length && !state.entries.some(e => e.round <= state.round && e.status === 'selected') && state.entries.some(e => e.round === state.round)) state.round++;
  if (state.round !== from) {
    if (undoable && state.undo) state.undo = { type:'roundAdvance', from, action:state.undo };
    else state.undo = null;
  }
}
export function unavailableReasons(record) {
  if (!record) return [];
  return Object.entries(record.reasons || { unknown: record.at }).map(([reason, at]) => ({ reason, at }));
}
export function songStatus(state, artist, song) {
  const key = songIdentity(text(artist, '歌手名'), text(song, '曲名'), state.suggestions);
  const record = state.unknown?.[key];
  return { unknownAt: record?.at || null, reasons: unavailableReasons(record) };
}
function collectedSongs(state, performances) {
  const songs = new Map((state.repertoire || []).map(song => [song.songKey, song]));
  for (const {artist, song, songKey} of performances) {
    const key = songKey || songIdentity(artist, song, state.suggestions);
    songs.set(key, {artist, song, songKey:key});
  }
  return [...songs.values()];
}
export function playableSongs(state) {
  return collectedSongs(state, state.history || [])
    .filter(entry => !state.unknown?.[entry.songKey])
    .map(({artist, song}) => ({artist, song, category:classifyArtist(artist)}));
}
function playedForRound(state, current) {
  const completed = state.entries.filter(entry => entry.status === 'done');
  const byId = new Map(completed.map(entry => [entry.id, entry]));
  const recorded = new Set();
  const played = [];
  for (const item of state.history || []) {
    let entry = byId.get(item.requestId);
    if (!item.requestId) {
      // Before request IDs were stored, match the last draw before this performance.
      for (const candidate of completed) {
        if (candidate.song !== item.song || candidate.artist !== item.artist || recorded.has(candidate.id)
          || !candidate.drawnAt || candidate.drawnAt > item.performedAt) continue;
        if (!entry || candidate.drawnAt > entry.drawnAt) entry = candidate;
      }
    }
    if (entry) recorded.add(entry.id);
    if ((item.round ?? entry?.round) === state.round) {
      played.push({ song:item.song, artist:item.artist, performedAt:item.performedAt });
    }
  }
  for (const entry of completed) {
    if (entry.round === state.round && !recorded.has(entry.id)) {
      played.push({ song:entry.song, artist:entry.artist, performedAt:entry.revealedAt ?? null });
    }
  }
  if (current?.status === 'selected' && current.round === state.round && current.revealedAt) {
    played.push({ song:current.song, artist:current.artist, performedAt:current.revealedAt });
  }
  return played.sort((a, b) => (a.performedAt ?? 0) - (b.performedAt ?? 0));
}
export function publicState(state) {
  const current = state.entries.find(e => e.id === state.current);
  const played = (state.history || []).filter(e => e.session === state.session).map(e => ({ song: e.song, artist: e.artist, performedAt: e.performedAt }));
  // Older saves have song keys but no timestamps. Keep their visible history without inventing a date.
  for (const key of state.sung) if (!played.some(e => songIdentity(e.artist, e.song, state.suggestions) === key)) {
    const entry = state.entries.findLast(e => e.songKey === key && e.status === 'done');
    if (entry) played.push({ song: entry.song, artist: entry.artist, performedAt: null });
  }
  if (current?.status === 'selected' && current.revealedAt) {
    played.push({ song: current.song, artist: current.artist, performedAt: current.revealedAt });
  }
  return { round: state.round, session: state.session, open: true, nextRound: state.round + 1, reserved: state.entries.filter(e => e.round === state.round + 1 && !['done','removed','skipped'].includes(e.status)).length, remaining: eligible(state).length, candidates: eligible(state).map(e => ({ song: e.song })), played, roundPlayed:playedForRound(state, current), result: current ? { id: current.id, song: current.song, artist: current.artist, status: current.status, drawnAt: current.drawnAt } : null };
}
export function ownRequests(state, hashes) {
  const allowed = new Set(hashes);
  return state.entries.filter(e => allowed.has(e.tokenHash)).map(e => listenerRequest(state, e));
}
export function listenerRequest(state, entry) {
  const { id, artist, song, round, status, deferReason, createdAt } = entry;
  return { id, artist, song, category: categoryOf(entry), round, status, deferReason, createdAt, playedThisSession: state.sung.includes(entry.songKey) };
}
export function requestsByName(state, name) {
  const key = nameKey(text(name, 'Pocochaの名前', 50));
  const entries = state.entries.filter(entry => !entry.encoreOf && nameKey(entry.name) === key)
    .map(entry => listenerRequest(state, entry));
  const occupiedSlots = state.entries.filter(entry => [state.round, state.round + 1].includes(entry.round)
    && entry.usedNames.includes(key))
    .map(entry => ({round:entry.round, category:categoryOf(entry)}));
  return {entries, occupiedSlots, round:state.round};
}
export function canRename(state, entry) {
  return [state.round, state.round + 1].includes(entry.round) && ['pending', 'deferred'].includes(entry.status);
}
function canEditSong(state, entry) {
  return canRename(state, entry) && (entry.status === 'pending' || !entry.drawnAt);
}
export function receipt(state, tokenHash) {
  const entry = state.entries.findLast(e => e.tokenHash === tokenHash);
  return entry ? listenerReceipt(state, entry, !entry.accountId) : null;
}
export function listenerReceipt(state, entry, canManage) {
  const { id, name, artist, song, round, status, deferReason } = entry;
  return { id, name, artist, song, category: categoryOf(entry), round, status, deferReason,
    editable: canManage && canRename(state, entry), songEditable: canManage && canEditSong(state, entry) };
}
export function accountRequests(state, accountId) {
  const entries = state.entries.filter(entry => entry.accountId === accountId);
  return {
    name: entries.at(-1)?.name || '',
    entries: entries.map(entry => listenerRequest(state, entry)),
    receipts: entries.filter(entry => entry.round === state.round || entry.round === state.round + 1)
      .map(entry => listenerReceipt(state, entry, true))
  };
}
export function submit(state, input, tokenHash, now = Date.now(), accountId = null) {
  const round = input.round === undefined ? state.round : input.round;
  if (!Number.isInteger(round) || ![state.round, state.round+1].includes(round)) throw new Problem('受付回が切り替わりました。画面を更新して選び直してください。',409);
  const name = text(input.name, 'Pocochaの名前', 50), artist = text(input.artist, '歌手名'), song = text(input.song, '曲名');
  const key = nameKey(name), category = classifyArtist(artist);
  if (input.category !== undefined && input.category !== category) throw new Problem('歌手名に合う歌まね枠を選んでください。');
  const roundLabel = round === state.round ? '今回' : '次回の予約';
  if (state.entries.some(e => categoryOf(e) === category && e.round === round && (e.tokenHash === tokenHash || (accountId && e.accountId === accountId)))) {
    throw new Problem(`${roundLabel}の「${categoryLabel(category)}」はリクエスト済みです。`, 409, 'duplicate_request');
  }
  if (state.entries.some(e => categoryOf(e) === category && e.round === round && e.usedNames.includes(key))) {
    throw new Problem(`この名前では、${roundLabel}の「${categoryLabel(category)}」はリクエスト済みです。`, 409, 'duplicate_request');
  }
  if (state.entries.length >= 3000) throw new Problem('応募が上限に達しました。配信者にお知らせください。', 409);
  const songKey = songIdentity(artist, song, state.suggestions);
  const unknownAt = state.unknown?.[songKey]?.at;
  if (unknownAt && input.unknownAcknowledgedAt !== unknownAt) throw new Problem('この曲の「歌えない理由」の記録を確認してから、もう一度リクエストしてください。', 409);
  const deferReason = state.sung.includes(songKey) ? 'sung' : (state.held || []).includes(songKey) ? 'unknown' : null;
  const entry = { id: crypto.randomUUID(), name, usedNames: [key], artist, song, songKey, category, tokenHash, round, status: deferReason ? 'deferred' : 'pending', deferReason, createdAt: now };
  if (accountId) entry.accountId = accountId;
  state.entries.push(entry);
  rememberSong(state, artist, song);
  return entry;
}
export function rename(state, entry, value) {
  if (!canRename(state, entry)) throw new Problem('名前の修正受付は終了しました。配信者にお知らせください。', 409);
  const name = text(value, 'Pocochaの名前', 50), key = nameKey(name);
  if (state.entries.some(e => e.id !== entry.id && e.round === entry.round && categoryOf(e) === categoryOf(entry) && e.usedNames.includes(key))) throw new Problem('その名前は今回すでに応募されています。', 409);
  entry.name = name;
  if (!entry.usedNames.includes(key)) entry.usedNames.push(key);
}
function rememberSong(state, artist, song) {
  if (![...catalog, ...state.suggestions].some(c => normalize(c.artist) === normalize(artist) && normalize(c.song) === normalize(song))) state.suggestions.push({ id: crypto.randomUUID(), artist, song, count: 1 });
}
export function editSong(state, entry, input) {
  if (!canEditSong(state, entry)) throw new Problem('このリクエストの曲は変更できません。', 409);
  const artist = text(input.artist, '歌手名'), song = text(input.song, '曲名');
  if (classifyArtist(artist) !== categoryOf(entry)) throw new Problem('同じ歌まね枠の曲を選んでください。');
  const songKey = songIdentity(artist, song, state.suggestions);
  const unknownAt = state.unknown?.[songKey]?.at;
  if (unknownAt && input.unknownAcknowledgedAt !== unknownAt) throw new Problem('この曲の「歌えない理由」の記録を確認してください。', 409);
  const sameSong = entry.songKey === songKey;
  if (!sameSong) { delete entry.allowRepeat; delete entry.retryHeld; }
  const deferReason = ['manual', 'temporary'].includes(entry.deferReason) ? entry.deferReason : drawBlock(state, { ...entry, songKey });
  Object.assign(entry, {artist, song, songKey, deferReason, status: deferReason ? 'deferred' : 'pending'});
  rememberSong(state, artist, song);
  finishRounds(state, false);
}
function pick(length) {
  const ceiling = Math.floor(4294967296 / length) * length;
  let n; do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= ceiling);
  return n % length;
}
function byId(state, id) {
  const entry = state.entries.find(item => item.id === id);
  if (!entry) throw new Problem('リクエストが見つかりません。', 404);
  return entry;
}
const queueFields = ['round', 'status', 'deferReason', 'retryHeld', 'allowRepeat', 'drawnAt', 'revealedAt', 'manualPick', 'autoDone', 'unavailableReason', 'unavailableAt'];
function rememberQueueChange(state, entries) {
  const undo = { type:'queue', current:state.current, entries:entries.map(entry => ({
    id:entry.id, fields:Object.fromEntries(queueFields.filter(key => key in entry).map(key => [key, entry[key]]))
  })) };
  state.undo = undo;
  return undo;
}
function sameListener(left, right) {
  return (left.accountId && left.accountId === right.accountId)
    || (left.tokenHash && left.tokenHash === right.tokenHash)
    || left.usedNames.some(name => right.usedNames.includes(name));
}
function destinationConflict(state, entry, input) {
  const conflicts = state.entries.filter(item => item !== entry && !item.encoreOf && item.round === state.round
    && categoryOf(item) === categoryOf(entry) && ['pending','selected','deferred'].includes(item.status) && sameListener(entry, item));
  if (!conflicts.length) return null;
  const [conflict] = conflicts;
  if (conflicts.length > 1 || conflict.status === 'selected') throw new Problem('同じ枠に処理中のリクエストがあります。先にその曲を処理してください。', 409);
  if (input.replaceId === conflict.id) return conflict;
  const error = new Problem('同じ人が今回の同じ枠に別の曲をリクエストしています。', 409, 'request_slot_conflict');
  error.details = { id:conflict.id, song:conflict.song };
  throw error;
}
function queueForThisDraw(state, entry, replaced) {
  if (replaced) replaced.status = 'removed';
  entry.round = state.round;
  entry.status = 'pending';
  entry.deferReason = null;
  delete entry.revealedAt;
  delete entry.drawnAt;
  delete entry.manualPick;
  delete entry.autoDone;
  if (state.current === entry.id || (replaced && state.current === replaced.id)) state.current = null;
}
function chooseEntry(state, entry, manual = false) {
  state.undo = { type:'draw', id:entry.id, previous:state.current };
  delete entry.revealedAt;
  entry.status = 'selected';
  entry.drawnAt = Date.now();
  entry.manualPick = manual;
  if (manual) entry.revealedAt = entry.drawnAt;
  state.current = entry.id;
}
function performanceFor(state, entry) {
  const linked = state.history.find(item => item.requestId === entry.id);
  if (linked || !entry.drawnAt) return linked;
  return state.history.filter(item => !item.requestId && item.song === entry.song && item.artist === entry.artist
    && item.performedAt >= entry.drawnAt).sort((a, b) => a.performedAt - b.performedAt)[0];
}
export function adminAction(state, input, now = Date.now()) {
  state.held ||= []; state.unknown ||= {}; state.history ||= [];
  const current = state.entries.find(e => e.id === state.current);
  const category = input.category ?? 'all';
  if (['draw','advance'].includes(input.action) && !['all','yamapi','other'].includes(category)) throw new Problem('抽選対象を選んでください。');
  const overridesWinner = input.action === 'cantSing' || (input.action === 'defer' && input.selected);
  if (overridesWinner && current?.status === 'done' && current.autoDone) {
    if (input.id !== current.id || (input.drawnAt !== undefined && input.drawnAt !== current.drawnAt)) {
      throw new Problem('当選曲が変わりました。確認してから操作してください。', 409);
    }
    if (input.action === 'cantSing' && !['unknown','no_audio'].includes(input.reason)) {
      throw new Problem('歌えない理由を選んでください。');
    }
    state.undo = current.autoDone;
    adminAction(state, {action:'undo'});
    adminAction(state, input);
    state.undo = {type:'autoOverride', id:current.id, action:state.undo};
    return;
  }
  switch (input.action) {
    case 'open': state.open = true; break;
    case 'close': throw new Problem('リクエストは常時受け付けています。');
    case 'advance': {
      let completed = null;
      if (current?.status === 'selected') { adminAction(state, { action: 'done' }); completed = state.undo; }
      if (!eligible(state,category).length) {
        if (!completed) throw new Problem('抽選できるリクエストがありません。', 409);
        state.undo = { type: 'advance', completed, drawn: null }; break;
      }
      adminAction(state, { action: 'draw', category });
      state.undo = { type: 'advance', completed, drawn: state.undo }; break;
    }
    case 'draw': {
      if (current?.status === 'selected') throw new Problem('今の曲を歌唱済みか見送りにしてください。', 409);
      const pool = eligible(state,category);
      if (!pool.length) throw new Problem('抽選できるリクエストがありません。', 409);
      const entry = pool[pick(pool.length)];
      chooseEntry(state, entry);
      break;
    }
    case 'selectSong': {
      if (current?.status === 'selected') throw new Problem('今の当選曲を先に処理してください。', 409);
      const entry = eligible(state).find(item => item.id === input.id);
      if (!entry) throw new Problem('今回の抽選待ちの曲を選んでください。', 409);
      chooseEntry(state, entry, true);
      break;
    }
    case 'reveal':
      if (current?.status !== 'selected' || current.id !== input.id || current.drawnAt !== input.drawnAt) {
        throw new Problem('当選曲が変わりました。確認してから操作してください。', 409);
      }
      current.revealedAt ??= Date.now();
      return;
    case 'completeDraw': {
      if (current?.id !== input.id || current?.drawnAt !== input.drawnAt || !current) {
        throw new Problem('当選曲が変わりました。確認してから操作してください。', 409);
      }
      if (current.status === 'done' && current.autoDone) return;
      if (current.status !== 'selected') throw new Problem('抽選中の曲がありません。', 409);
      const previous = state.undo;
      const lastDraw = previous?.type === 'advance' ? previous.drawn : previous;
      const drawn = lastDraw?.type === 'draw' && lastDraw.id === current.id ? previous : null;
      current.revealedAt ??= Date.now();
      adminAction(state, {action:'done', id:current.id});
      const completed = state.undo;
      current.autoDone = completed.type === 'roundAdvance' ? completed.action : completed;
      state.undo = {type:'autoDraw', drawn, completed};
      return;
    }
    case 'done': {
      if (current?.status !== 'selected') throw new Problem('抽選中の曲がありません。', 409);
      if (input.id && current.id !== input.id) throw new Problem('当選曲が変わりました。', 409);
      const key = current.songKey;
      const historyId = crypto.randomUUID();
      state.undo = { type: 'done', id: current.id, key, historyId, newlySung: !state.sung.includes(key), unknownBefore: state.unknown[key] || null };
      current.status = 'done';
      state.history.push({ id: historyId, requestId:current.id, round:current.round, songKey:key, unknownBefore:state.undo.unknownBefore, session: state.session, song: current.song, artist: current.artist, performedAt: current.revealedAt ?? Date.now() });
      delete state.unknown[key];
      if (!state.sung.includes(key)) state.sung.push(key);
      for (const e of state.entries) if (e.status === 'pending' && e.songKey === key && !e.allowRepeat) { e.status = 'deferred'; e.deferReason = 'sung'; }
      break;
    }
    case 'cantSing':
    case 'unknown': {
      const reason = input.action === 'unknown' ? 'unknown' : input.reason;
      if (!['unknown', 'no_audio'].includes(reason)) throw new Problem('歌えない理由を選んでください。');
      if (current?.status !== 'selected') throw new Problem('抽選中の曲がありません。', 409);
      if (input.id && current.id !== input.id) throw new Problem('当選曲が変わりました。確認してから操作してください。', 409);
      const key = current.songKey, previous = state.unknown[key] || null;
      const affected = state.entries.filter(e => e.songKey === key && ['pending', 'selected'].includes(e.status)).map(e => ({ id: e.id, status: e.status, deferReason: e.deferReason }));
      state.undo = { type: 'unknown', id: current.id, key, previous, hadHold: state.held.includes(key), affected };
      const at = Math.max(Date.now(), (previous?.at || 0) + 1);
      const reasons = Object.fromEntries(unavailableReasons(previous).map(item => [item.reason, item.at]));
      reasons[reason] = at;
      state.undo.previousReason = current.unavailableReason;
      state.undo.previousAt = current.unavailableAt;
      current.unavailableReason = reason;
      current.unavailableAt = at;
      state.unknown[key] = { at, reasons, artist: current.artist, song: current.song };
      if (!state.held.includes(key)) state.held.push(key);
      for (const e of state.entries) if (affected.some(a => a.id === e.id)) { e.status = 'deferred'; e.deferReason = 'unknown'; }
      break;
    }
    case 'skip':
      if (current?.status !== 'selected') throw new Problem('抽選中の曲がありません。', 409);
      current.status = 'skipped'; state.undo = { type: 'skip', id: current.id }; break;
    case 'undo': {
      const u = state.undo;
      if (!u) throw new Problem('戻せる操作がありません。', 409);
      if (u.type === 'roundAdvance') {
        state.round = u.from; state.undo = u.action; adminAction(state,{action:'undo'}); break;
      }
      if (u.type === 'autoDraw') {
        state.undo = u.completed;
        adminAction(state, {action:'undo'});
        if (u.drawn) {
          state.undo = u.drawn;
          adminAction(state, {action:'undo'});
        }
        break;
      }
      if (u.type === 'autoOverride') {
        state.undo = u.action;
        adminAction(state, {action:'undo'});
        const entry = state.entries.find(item => item.id === u.id);
        if (entry?.status === 'selected' && state.current === entry.id) {
          adminAction(state, {action:'completeDraw', id:entry.id, drawnAt:entry.drawnAt});
        }
        state.undo = null;
        break;
      }
      if (u.type === 'advance') {
        if (u.drawn) { state.undo = u.drawn; adminAction(state, { action: 'undo' }); }
        if (u.completed) { state.undo = u.completed; adminAction(state, { action: 'undo' }); }
        state.undo = null; break;
      }
      if (u.type === 'unknown') {
        if (u.previous) state.unknown[u.key] = u.previous; else delete state.unknown[u.key];
        if (!u.hadHold) state.held = state.held.filter(key => key !== u.key);
        for (const entry of state.entries) {
          const before = entry.songKey === u.key && u.affected.find(a => a.id === entry.id);
          if (before) { entry.status = before.status; entry.deferReason = before.deferReason; }
          else if (!u.hadHold && entry.songKey === u.key && entry.status === 'deferred' && entry.deferReason === 'unknown') { entry.status = 'pending'; entry.deferReason = null; }
        }
        const original = state.entries.find(entry => entry.id === u.id);
        if (original) {
          original.unavailableReason = u.previousReason;
          original.unavailableAt = u.previousAt;
        }
        state.current = u.id; state.undo = null; break;
      }
      if (u.type === 'queue') {
        if (u.addedId) state.entries = state.entries.filter(entry => entry.id !== u.addedId);
        for (const saved of u.entries) {
          const entry = state.entries.find(item => item.id === saved.id);
          if (!entry) continue;
          for (const key of queueFields) delete entry[key];
          Object.assign(entry, saved.fields);
        }
        if (u.performance) state.history.splice(u.historyIndex, 0, u.performance);
        if (u.sungKey && !state.sung.includes(u.sungKey)) {
          state.sung.push(u.sungKey);
          for (const entry of state.entries) if (entry.songKey === u.sungKey && entry.status === 'pending' && !entry.allowRepeat) {
            entry.status = 'deferred';
            entry.deferReason = 'sung';
          }
        }
        if (u.correctedKey) {
          if (u.previousRecord) state.unknown[u.correctedKey] = u.previousRecord;
          else delete state.unknown[u.correctedKey];
        }
        state.current = state.entries.some(entry => entry.id === u.current) ? u.current : null;
        state.undo = null;
        break;
      }
      const e = state.entries.find(e => e.id === u.id);
      if (u.type === 'draw') {
        if (e) {
          e.deferReason = drawBlock(state, e);
          e.status = e.deferReason ? 'deferred' : 'pending';
          delete e.manualPick;
          delete e.revealedAt;
        }
        state.current = u.previous;
      }
      if (u.type === 'skip' && e) e.status = 'selected';
      if (['defer', 'deferSelected'].includes(u.type) && e) {
        e.status = u.previousStatus ?? 'selected';
        e.deferReason = u.previousReason;
        if (e.status === 'selected') state.current = e.id;
      }
      if (u.type === 'done' && e) {
        delete e.autoDone;
        e.status = 'selected';
        state.history = state.history.filter(item => item.id !== u.historyId);
        if ('unknownBefore' in u) { if (u.unknownBefore) state.unknown[u.key] = u.unknownBefore; else delete state.unknown[u.key]; }
        if (u.newlySung) {
          state.sung = state.sung.filter(key => key !== u.key);
          for (const item of state.entries) if (item.status === 'deferred' && item.songKey === u.key && (!item.deferReason || item.deferReason === 'sung')) {
            item.deferReason = drawBlock(state, item);
            item.status = item.deferReason ? 'deferred' : 'pending';
          }
        }
      }
      state.undo = null; break;
    }
    case 'round': throw new Problem('その回のリクエストを処理すると自動で切り替わります。',409);
    case 'session':
      if (current?.status === 'selected') throw new Problem('今の曲を処理してから配信を切り替えてください。', 409);
      state.session++; state.sung = []; state.held = []; state.current = null; state.undo = null;
      state.sessionSwitchDate = jstDay(now);
      for (const e of state.entries) {
        delete e.allowRepeat;
        delete e.retryHeld;
        if (e.status === 'deferred') { e.status = 'pending'; e.deferReason = null; }
      }
      break;
    case 'edit': {
      const e = state.entries.find(e => e.id === input.id);
      if (!e) throw new Problem('応募が見つかりません。', 404);
      if (e.status !== 'pending') throw new Problem('抽選待ちに戻してから変更してください。', 409);
      const name = text(input.name, '名前', 50), key = nameKey(name);
      const artist = text(input.artist,'歌手名'), category = classifyArtist(artist);
      if (state.entries.some(v => v.id !== e.id && v.round === e.round && categoryOf(v) === category && v.usedNames.includes(key))) throw new Problem('その名前は応募済みです。', 409);
      e.name = name; if (!e.usedNames.includes(key)) e.usedNames.push(key);
      e.artist = artist; e.category = category; e.song = text(input.song, '曲名');
      const songKey = songIdentity(e.artist, e.song, state.suggestions);
      if (songKey !== e.songKey) { delete e.allowRepeat; delete e.retryHeld; }
      e.songKey = songKey;
      e.deferReason = drawBlock(state, e);
      e.status = e.deferReason ? 'deferred' : 'pending';
      state.undo = null; break;
    }
    case 'defer': {
      const e = state.entries.find(e => e.id === input.id);
      const isSelected = e && e === current && e.status === 'selected';
      if (input.selected ? !isSelected : e?.status !== 'pending') throw new Problem(input.selected ? '当選曲が変わりました。確認してから操作してください。' : '待機中の応募を選んでください。', 409);
      state.undo = { type: 'defer', id: e.id, previousStatus: e.status, previousReason: e.deferReason ?? null };
      e.status = 'deferred'; e.deferReason = 'manual'; break;
    }
    case 'hold': {
      const entry = byId(state, input.id);
      if (!eligible(state).includes(entry)) throw new Problem('今回の抽選待ちの曲を選んでください。', 409);
      rememberQueueChange(state, [entry]);
      entry.status = 'deferred';
      entry.deferReason = 'temporary';
      break;
    }
    case 'bringForward':
    case 'restoreRequest': {
      const entry = byId(state, input.id);
      const moving = input.action === 'bringForward';
      const allowed = moving ? entry.status === 'pending' && entry.round === state.round + 1
        : ['deferred','skipped','removed'].includes(entry.status);
      if (!allowed) throw new Problem('リクエストの状態が変わりました。', 409);
      const replaced = destinationConflict(state, entry, input);
      rememberQueueChange(state, replaced ? [entry, replaced] : [entry]);
      if (!moving) {
        if (state.sung.includes(entry.songKey)) entry.allowRepeat = true;
        if (state.held.includes(entry.songKey)) entry.retryHeld = true;
      }
      queueForThisDraw(state, entry, replaced);
      break;
    }
    case 'correctReason': {
      const entry = byId(state, input.id);
      const previous = state.unknown[entry.songKey];
      const reasons = Object.fromEntries(unavailableReasons(previous).map(item => [item.reason, item.at]));
      const oldReason = entry.unavailableReason || (Object.keys(reasons).length === 1 ? Object.keys(reasons)[0] : null);
      if (entry.status !== 'deferred' || entry.deferReason !== 'unknown' || !reasons[oldReason]
        || !['unknown','no_audio'].includes(input.reason) || input.reason === oldReason) {
        throw new Problem('訂正できる理由がありません。', 409);
      }
      const originalAt = entry.unavailableAt ?? reasons[oldReason];
      if (reasons[oldReason] !== originalAt) throw new Problem('この曲の理由は別の操作で更新されています。', 409);
      Object.assign(rememberQueueChange(state, [entry]), { correctedKey:entry.songKey, previousRecord:previous });
      delete reasons[oldReason];
      reasons[input.reason] = Math.max(reasons[input.reason] ?? 0, originalAt);
      entry.unavailableReason = input.reason;
      entry.unavailableAt = reasons[input.reason];
      state.unknown[entry.songKey] = { ...previous, at:Math.max(Date.now(), previous.at + 1), reasons };
      break;
    }
    case 'cancelPerformance': {
      const entry = byId(state, input.id);
      if (entry.status !== 'done') throw new Problem('歌唱済みの曲を選んでください。', 409);
      const replaced = destinationConflict(state, entry, input);
      const performance = performanceFor(state, entry);
      const otherPerformances = state.history.filter(item => item !== performance
        && (item.songKey ?? songIdentity(item.artist, item.song, state.suggestions)) === entry.songKey);
      const remainingPerformance = otherPerformances.some(item => item.session === state.session);
      const clearSung = state.sung.includes(entry.songKey) && !remainingPerformance
        && (performance ? performance.session === state.session : !state.entries.some(item => item !== entry && item.status === 'done' && item.songKey === entry.songKey));
      const related = clearSung ? state.entries.filter(item => item !== replaced && item.songKey === entry.songKey
        && item.status === 'deferred' && (!item.deferReason || item.deferReason === 'sung')) : [];
      const undo = rememberQueueChange(state, [entry, ...(replaced ? [replaced] : []), ...related]);
      if (performance) {
        undo.performance = performance;
        undo.historyIndex = state.history.indexOf(performance);
        state.history.splice(undo.historyIndex, 1);
        if (performance.unknownBefore && !state.unknown[entry.songKey]
          && !otherPerformances.some(item => item.performedAt >= performance.performedAt)) {
          Object.assign(undo, {correctedKey:entry.songKey, previousRecord:null});
          state.unknown[entry.songKey] = performance.unknownBefore;
        }
      }
      if (clearSung) {
        undo.sungKey = entry.songKey;
        state.sung = state.sung.filter(key => key !== entry.songKey);
        for (const item of related) {
          item.deferReason = drawBlock(state, item);
          item.status = item.deferReason ? 'deferred' : 'pending';
        }
      }
      if (state.sung.includes(entry.songKey)) entry.allowRepeat = true;
      if (state.held.includes(entry.songKey)) entry.retryHeld = true;
      queueForThisDraw(state, entry, replaced);
      break;
    }
    case 'encore': {
      const entry = byId(state, input.id);
      if (entry.status !== 'done') throw new Problem('歌唱済みの曲を選んでください。', 409);
      if (state.entries.some(item => item.encoreOf && item.songKey === entry.songKey && ['pending','selected'].includes(item.status))) {
        throw new Problem('この曲はすでに再演用に追加されています。', 409);
      }
      if (state.entries.length >= 3000) throw new Problem('リクエストが上限に達しています。', 409);
      const id = crypto.randomUUID();
      rememberQueueChange(state, []).addedId = id;
      state.entries.push({ id, encoreOf:entry.id, name:entry.name, usedNames:[], artist:entry.artist, song:entry.song,
        songKey:entry.songKey, category:categoryOf(entry), round:state.round, status:'pending', deferReason:null,
        allowRepeat:true, retryHeld:true, createdAt:Date.now() });
      break;
    }
    case 'remove': {
      const e = state.entries.find(e => e.id === input.id);
      if (!e) throw new Problem('応募が見つかりません。', 404);
      if (e.status !== 'pending') throw new Problem('抽選待ちのリクエストを選んでください。', 409);
      rememberQueueChange(state, [e]);
      e.status = 'removed'; if (state.current === e.id) state.current = null; break;
    }
    case 'resetRequest': {
      const entry = byId(state, input.id);
      const expected = input.expected;
      if (!expected || entry.name !== expected.name || entry.artist !== expected.artist || entry.song !== expected.song || entry.status !== expected.status) {
        throw new Problem('リクエストが更新されました。最新の内容を確認してください。', 409);
      }
      if (entry.status === 'done') {
        const performance = performanceFor(state, entry);
        if (performance) {
          performance.requestId = entry.id;
          performance.round ??= entry.round;
        } else {
          // Old records can store a sung request without a separate performance.
          const {round, songKey, song, artist, createdAt} = entry;
          state.history.push({requestId:entry.id, round, songKey, song, artist, createdAt,
            session:state.sung.includes(songKey) ? state.session : null, performedAt:entry.revealedAt ?? null});
        }
      }
      state.entries.splice(state.entries.indexOf(entry), 1);
      if (state.current === entry.id) state.current = null;
      state.undo = null;
      // Keep the same round open so the listener can fill the vacated slot.
      return;
    }
    case 'removeSuggestion': state.suggestions = state.suggestions.filter(s => s.id !== input.id); break;
    default: throw new Problem('操作を確認してください。');
  }
  if (!['undo','open'].includes(input.action)) finishRounds(state);
}
export function prune(state, now = Date.now()) {
  const cutoff = now - state.retentionDays * 86400000;
  if (state.history) {
    const expired = state.history.filter(entry => (entry.performedAt ?? entry.createdAt) < cutoff);
    if (expired.length) state.repertoire = collectedSongs(state, expired);
    state.history = state.history.filter(entry => (entry.performedAt ?? entry.createdAt) >= cutoff);
  }
  if (!state.entries.some(e => e.id === state.current)) state.current = null;
}
