import { api, $, message, safeGet, safeSet, normalize, statusText } from './common.mjs';
let state, mine, items = [], tokens;
try { tokens = JSON.parse(safeGet('emupi-request-tokens') || '{}'); } catch { tokens = {}; }
const lastToken = () => Object.values(tokens).at(-1);
function tokenFor(round) {
  if (!tokens[round]) { tokens[round] = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); safeSet('emupi-request-tokens', JSON.stringify(tokens)); }
  return tokens[round];
}
$('name').value = safeGet('emupi-request-name') || '';
function render() {
  $('status').textContent = state.open ? '受付中' : '受付終了'; $('status').classList.toggle('closed', !state.open);
  const entered = mine?.round === state.round;
  $('form-card').hidden = !state.open || entered;
  $('waiting').hidden = state.open || !!mine;
  $('receipt').hidden = !mine;
  $('next-note').hidden = !state.open || !mine || entered;
  if (mine) { $('my-song').textContent = mine.song; $('my-artist').textContent = mine.artist; $('my-name').textContent = `${mine.name} さん`; $('my-status').textContent = statusText[mine.status]; $('rename').hidden = !mine.editable; }
}
async function refresh() {
  state = await api('/api/state');
  const token = tokens[state.round] || lastToken();
  mine = token ? (await api('/api/mine', { token })).entry : null;
  render();
}
$('request-form').addEventListener('submit', async event => {
  event.preventDefault(); $('submit').disabled = true; message('');
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const status = await api(`/api/song-status?${new URLSearchParams({artist:data.artist,song:data.song})}`);
    if(status.unknownAt){
      const date=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(status.unknownAt);
      $('unknown-description').textContent=`この曲は、${date}時点でえむぴーがまだ覚えていませんでした。それでもリクエストしますか？`;
      const dialog=$('unknown-warning');dialog.returnValue='';
      const confirmed=await new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='request'),{once:true});dialog.showModal();});
      if(!confirmed){$('song').focus();return;}
      data.unknownAcknowledgedAt=status.unknownAt;
    }
    mine = (await api('/api/requests', { method: 'POST', data, token: tokenFor(state.round) })).entry;
    safeSet('emupi-request-name', mine.name); $('song').value = ''; render();
  } catch (error) { message(error.message, true); }
  finally { $('submit').disabled = false; }
});
$('rename').addEventListener('click', () => { $('rename-form').hidden = !$('rename-form').hidden; $('new-name').value = mine.name; if (!$('rename-form').hidden) $('new-name').focus(); });
$('rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try { mine = (await api('/api/mine', { method: 'PATCH', data: { name: $('new-name').value }, token: tokens[mine.round] })).entry; safeSet('emupi-request-name', mine.name); $('name').value = mine.name; $('rename-form').hidden = true; render(); message('名前を修正しました。'); }
  catch (error) { message(error.message, true); } finally { button.disabled = false; }
});
function suggest(kind) {
  for (const other of ['artist','song']) if(other !== kind) { $(`${other}-suggestions`).hidden=true; $(other).setAttribute('aria-expanded','false'); }
  const input = $(kind), box = $(`${kind}-suggestions`), value = normalize(input.value);
  box.replaceChildren();
  if (!value) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  let candidates;
  if (kind === 'artist') {
    candidates = [...new Map(items.filter(i => [i.artist, ...(i.artistAliases || [])].some(v => normalize(v).includes(value))).map(i => [i.artist, { label: i.artist }])).values()];
  } else {
    const a = normalize($('artist').value);
    candidates = items.filter(i => [i.song, ...(i.aliases || [])].some(v => normalize(v).includes(value))).sort((x,y) => Number([y.artist,...(y.artistAliases||[])].some(v=>normalize(v)===a))-Number([x.artist,...(x.artistAliases||[])].some(v=>normalize(v)===a))).map(i => ({ label: `${i.song} · ${i.artist}`, item: i }));
  }
  for (const candidate of candidates.slice(0, 7)) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = candidate.label;
    button.addEventListener('click', () => { input.value = kind === 'artist' ? candidate.label : candidate.item.song; if (kind === 'song' && !$('artist').value) $('artist').value = candidate.item.artist; box.hidden = true; input.setAttribute('aria-expanded', 'false'); input.focus(); }); box.append(button);
  }
  box.hidden = !box.children.length; input.setAttribute('aria-expanded', String(!box.hidden));
}
for (const kind of ['artist', 'song']) { $(kind).addEventListener('input', () => suggest(kind)); $(kind).addEventListener('focus', () => { for (const other of ['artist','song']) if(other!==kind) { $(`${other}-suggestions`).hidden=true; $(other).setAttribute('aria-expanded','false'); } }); $(kind).addEventListener('keydown', e => { const buttons = [...$(`${kind}-suggestions`).querySelectorAll('button')]; if(e.key==='ArrowDown' && buttons.length){e.preventDefault();buttons[0].focus();} if(e.key==='Escape') $(`${kind}-suggestions`).hidden=true; }); }
document.addEventListener('click', event => { if (!event.target.closest('.sug-wrap')) for (const kind of ['artist','song']) { $(`${kind}-suggestions`).hidden = true; $(kind).setAttribute('aria-expanded','false'); } });
async function start() { try { await refresh(); items = (await api('/api/suggestions')).items; message(''); } catch(error) { message(error.message,true); } }
await start();
setInterval(() => { if (!document.hidden) refresh().catch(error => message(error.message,true)); }, 15000);
