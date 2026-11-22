import { catalog } from '../request/catalog.mjs';

export class Problem extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
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
export function initialState() {
  return { round: 1, session: 1, open: false, entries: [], sung: [], held: [], unknown: {}, history: [], current: null, undo: null, suggestions: [], retentionDays: 30 };
}
export function eligible(state) { return state.entries.filter(e => e.status === 'pending' && !state.sung.includes(e.songKey) && !(state.held || []).includes(e.songKey)); }
export function songStatus(state, artist, song) {
  const key = songIdentity(text(artist, '歌手名'), text(song, '曲名'), state.suggestions);
  return { unknownAt: state.unknown?.[key]?.at || null };
}
export function publicState(state) {
  const current = state.entries.find(e => e.id === state.current);
  const played = (state.history || []).filter(e => e.session === state.session).map(e => ({ song: e.song, artist: e.artist, performedAt: e.performedAt }));
  // Older saves have song keys but no timestamps. Keep their visible history without inventing a date.
  for (const key of state.sung) if (!played.some(e => songIdentity(e.artist, e.song, state.suggestions) === key)) {
    const entry = state.entries.findLast(e => e.songKey === key && e.status === 'done');
    if (entry) played.push({ song: entry.song, artist: entry.artist, performedAt: null });
  }
  return { round: state.round, session: state.session, open: state.open, remaining: eligible(state).length, candidates: eligible(state).map(e => ({ song: e.song })), played, result: current ? { id: current.id, song: current.song, artist: current.artist, status: current.status, drawnAt: current.drawnAt } : null };
}
export function ownRequests(state, hashes) {
  const allowed = new Set(hashes);
  return state.entries.filter(e => allowed.has(e.tokenHash)).map(e => ({ id: e.id, artist: e.artist, song: e.song, round: e.round, status: e.status, createdAt: e.createdAt, playedThisSession: state.sung.includes(e.songKey) }));
}
export function receipt(state, tokenHash) {
  const entry = state.entries.findLast(e => e.tokenHash === tokenHash);
  return entry ? { id: entry.id, name: entry.name, artist: entry.artist, song: entry.song, round: entry.round, status: entry.status, deferReason: entry.deferReason, editable: state.open && state.round === entry.round } : null;
}
export function submit(state, input, tokenHash, now = Date.now()) {
  if (!state.open) throw new Problem('今は受付していません。次の受付をお待ちください。', 409);
  const name = text(input.name, 'Pocochaの名前', 50), artist = text(input.artist, '歌手名'), song = text(input.song, '曲名');
  const key = nameKey(name);
  if (state.entries.some(e => e.round === state.round && (e.usedNames.includes(key) || e.tokenHash === tokenHash))) throw new Problem('今回のリクエストは応募済みです。次の受付をお待ちください。', 409);
  if (state.entries.length >= 3000) throw new Problem('応募が上限に達しました。配信者にお知らせください。', 409);
  const songKey = songIdentity(artist, song, state.suggestions);
  const unknownAt = state.unknown?.[songKey]?.at;
  if (unknownAt && input.unknownAcknowledgedAt !== unknownAt) throw new Problem('この曲の「まだ覚えていない」記録を確認してから、もう一度リクエストしてください。', 409);
  const deferReason = state.sung.includes(songKey) ? 'sung' : (state.held || []).includes(songKey) ? 'unknown' : null;
  const entry = { id: crypto.randomUUID(), name, usedNames: [key], artist, song, songKey, tokenHash, round: state.round, status: deferReason ? 'deferred' : 'pending', deferReason, createdAt: now };
  state.entries.push(entry);
  if (![...catalog, ...state.suggestions].some(c => normalize(c.artist) === normalize(artist) && normalize(c.song) === normalize(song))) state.suggestions.push({ id: crypto.randomUUID(), artist, song, count: 1 });
  return entry;
}
export function rename(state, entry, value) {
  if (!state.open || state.round !== entry.round) throw new Problem('名前の修正受付は終了しました。配信者にお知らせください。', 409);
  const name = text(value, 'Pocochaの名前', 50), key = nameKey(name);
  if (state.entries.some(e => e.id !== entry.id && e.round === entry.round && e.usedNames.includes(key))) throw new Problem('その名前は今回すでに応募されています。', 409);
  entry.name = name;
  if (!entry.usedNames.includes(key)) entry.usedNames.push(key);
}
function pick(length) {
  const ceiling = Math.floor(4294967296 / length) * length;
  let n; do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= ceiling);
  return n % length;
}
export function adminAction(state, input) {
  state.held ||= []; state.unknown ||= {}; state.history ||= [];
  const current = state.entries.find(e => e.id === state.current);
  switch (input.action) {
    case 'open': state.open = true; break;
    case 'close': state.open = false; break;
    case 'advance': {
      let completed = null;
      if (current?.status === 'selected') { adminAction(state, { action: 'done' }); completed = state.undo; }
      if (!eligible(state).length) {
        if (!completed) throw new Problem('抽選できるリクエストがありません。', 409);
        state.undo = { type: 'advance', completed, drawn: null }; break;
      }
      adminAction(state, { action: 'draw' });
      state.undo = { type: 'advance', completed, drawn: state.undo }; break;
    }
    case 'draw': {
      if (current?.status === 'selected') throw new Problem('今の曲を歌唱済みか見送りにしてください。', 409);
      const pool = eligible(state);
      if (!pool.length) throw new Problem('抽選できるリクエストがありません。', 409);
      const entry = pool[pick(pool.length)];
      state.undo = { type: 'draw', id: entry.id, previous: state.current };
      entry.status = 'selected'; entry.drawnAt = Date.now(); state.current = entry.id;
      break;
    }
    case 'done': {
      if (current?.status !== 'selected') throw new Problem('抽選中の曲がありません。', 409);
      const key = current.songKey;
      const historyId = crypto.randomUUID();
      state.undo = { type: 'done', id: current.id, key, historyId, newlySung: !state.sung.includes(key), unknownBefore: state.unknown[key] || null };
      current.status = 'done';
      state.history.push({ id: historyId, session: state.session, song: current.song, artist: current.artist, performedAt: Date.now() });
      delete state.unknown[key];
      if (!state.sung.includes(key)) state.sung.push(key);
      for (const e of state.entries) if (e.status === 'pending' && e.songKey === key) { e.status = 'deferred'; e.deferReason = 'sung'; }
      break;
    }
    case 'unknown': {
      if (current?.status !== 'selected') throw new Problem('抽選中の曲がありません。', 409);
      const key = current.songKey, previous = state.unknown[key] || null;
      const affected = state.entries.filter(e => e.songKey === key && ['pending', 'selected'].includes(e.status)).map(e => ({ id: e.id, status: e.status, deferReason: e.deferReason }));
      state.undo = { type: 'unknown', id: current.id, key, previous, hadHold: state.held.includes(key), affected };
      state.unknown[key] = { at: Math.max(Date.now(), (previous?.at || 0) + 1), artist: current.artist, song: current.song };
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
      if (u.type === 'advance') {
        if (u.drawn) { state.undo = u.drawn; adminAction(state, { action: 'undo' }); }
        if (u.completed) { state.undo = u.completed; adminAction(state, { action: 'undo' }); }
        state.undo = null; break;
      }
      if (u.type === 'unknown') {
        if (u.previous) state.unknown[u.key] = u.previous; else delete state.unknown[u.key];
        if (!u.hadHold) state.held = state.held.filter(key => key !== u.key);
        for (const entry of state.entries) {
          const before = u.affected.find(a => a.id === entry.id);
          if (before) { entry.status = before.status; entry.deferReason = before.deferReason; }
          else if (!u.hadHold && entry.songKey === u.key && entry.status === 'deferred' && entry.deferReason === 'unknown') { entry.status = 'pending'; entry.deferReason = null; }
        }
        state.current = u.id; state.undo = null; break;
      }
      const e = state.entries.find(e => e.id === u.id);
      if (u.type === 'draw') { if (e) e.status = state.sung.includes(e.songKey) ? 'deferred' : 'pending'; state.current = u.previous; }
      if (u.type === 'skip' && e) e.status = 'selected';
      if (u.type === 'done' && e) {
        e.status = 'selected';
        state.history = state.history.filter(item => item.id !== u.historyId);
        if ('unknownBefore' in u) { if (u.unknownBefore) state.unknown[u.key] = u.unknownBefore; else delete state.unknown[u.key]; }
        if (u.newlySung) { state.sung = state.sung.filter(k => k !== u.key); for (const item of state.entries) if (item.status === 'deferred' && item.songKey === u.key && (!item.deferReason || item.deferReason === 'sung')) { item.status = 'pending'; item.deferReason = null; } }
      }
      state.undo = null; break;
    }
    case 'round':
      if (current?.status === 'selected') throw new Problem('今の曲を処理してから切り替えてください。', 409);
      state.round++; state.open = true; state.undo = null; break;
    case 'session':
      if (current?.status === 'selected') throw new Problem('今の曲を処理してから配信を切り替えてください。', 409);
      state.session++; state.sung = []; state.held = []; state.current = null; state.undo = null;
      for (const e of state.entries) if (e.status === 'deferred') { e.status = 'pending'; e.deferReason = null; }
      break;
    case 'edit': {
      const e = state.entries.find(e => e.id === input.id);
      if (!e) throw new Problem('応募が見つかりません。', 404);
      if (e.status === 'selected') throw new Problem('抽選を取り消してから修正してください。', 409);
      const name = text(input.name, '名前', 50), key = nameKey(name);
      if (state.entries.some(v => v.id !== e.id && v.round === e.round && v.usedNames.includes(key))) throw new Problem('その名前は応募済みです。', 409);
      e.name = name; if (!e.usedNames.includes(key)) e.usedNames.push(key);
      e.artist = text(input.artist, '歌手名'); e.song = text(input.song, '曲名');
      e.songKey = songIdentity(e.artist, e.song, state.suggestions);
      if (['pending', 'deferred'].includes(e.status)) { e.deferReason = state.sung.includes(e.songKey) ? 'sung' : state.held.includes(e.songKey) ? 'unknown' : null; e.status = e.deferReason ? 'deferred' : 'pending'; }
      state.undo = null; break;
    }
    case 'defer': {
      const e = state.entries.find(e => e.id === input.id);
      if (!e || e.status !== 'pending') throw new Problem('待機中の応募を選んでください。', 409);
      e.status = 'deferred'; e.deferReason = 'manual'; state.undo = null; break;
    }
    case 'remove': {
      const e = state.entries.find(e => e.id === input.id);
      if (!e) throw new Problem('応募が見つかりません。', 404);
      e.status = 'removed'; if (state.current === e.id) state.current = null; state.undo = null; break;
    }
    case 'removeSuggestion': state.suggestions = state.suggestions.filter(s => s.id !== input.id); break;
    default: throw new Problem('操作を確認してください。');
  }
}
export function prune(state, now = Date.now()) {
  const cutoff = now - state.retentionDays * 86400000;
  state.entries = state.entries.filter(e => e.createdAt >= cutoff);
  if (state.history) state.history = state.history.filter(e => e.performedAt >= cutoff);
  if (!state.entries.some(e => e.id === state.current)) state.current = null;
}
