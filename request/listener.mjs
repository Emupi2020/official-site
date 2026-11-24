import { classifyArtist, categoryLabel } from './categories.mjs';
import { api, $, message, safeGet, safeSet, normalize, statusText } from './common.mjs';
let state, mine, items = [], tokens, myRequests = [], selectedRound, selectedCategory = 'yamapi', mineToken;
try { tokens = JSON.parse(safeGet('emupi-request-tokens') || '{}'); } catch { tokens = {}; }
function tokenFor(round, category) {
  const key=`${round}:${category}`;
  if (!tokens[key]) { tokens[key] = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); safeSet('emupi-request-tokens', JSON.stringify(tokens)); }
  return tokens[key];
}
$('name').value = safeGet('emupi-request-name') || '';
function render() {
  $('status').textContent = selectedRound===state.round ? '今回のリクエスト' : '次回の予約';
  $('choose-current').textContent='今回';$('choose-next').textContent='次回の予約';
  $('choose-current').setAttribute('aria-pressed',String(selectedRound===state.round));$('choose-next').setAttribute('aria-pressed',String(selectedRound===state.round+1));
  $('choose-yamapi').setAttribute('aria-pressed',String(selectedCategory==='yamapi'));$('choose-other').setAttribute('aria-pressed',String(selectedCategory==='other'));
  const entered = mine?.round === selectedRound;
  $('form-card').hidden = entered;
  $('waiting').hidden = true;
  $('submit').textContent=selectedRound>state.round?'予約する':'リクエスト';
  $('receipt').hidden = !mine;
  $('next-note').hidden = true;
  $('receipt-title').textContent=selectedRound>state.round?'予約しました':'リクエストしました';
  if (mine) { $('my-song').textContent = mine.song; $('my-artist').textContent = mine.artist; $('my-name').textContent = `${mine.name} さん`; $('my-status').textContent = mine.round>state.round&&mine.status==='pending'?'次の回で抽選します。':statusText[mine.status]; $('rename').hidden = !mine.editable; }
  $('my-history').hidden=!myRequests.length;
  $('my-history-count').textContent=myRequests.length ? `${myRequests.length}件` : '';
  $('my-history-list').replaceChildren();
  const labels={pending:'抽選待ち',selected:'選択中',done:'歌唱済み',deferred:'次回へ保留',skipped:'見送り',removed:'取り下げ'};
  for(const entry of [...myRequests].reverse())historyRow($('my-history-list'),entry.song,entry.artist,`${categoryLabel(entry.category)} · ${entry.round>state.round?'次回の予約 · ':entry.round===state.round?'今回 · ':'過去のリクエスト · '}${labels[entry.status]||entry.status}${entry.status!=='done'&&entry.playedThisSession?' · 同じ曲は今回歌唱済み':''}`);
  const played=state.played||[];
  $('played-count').textContent=played.length?`${played.length}曲`:'';
  $('played-empty').hidden=!!played.length;
  $('played-list').replaceChildren();
  for(const entry of [...played].reverse())historyRow($('played-list'),entry.song,entry.artist,entry.performedAt?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(entry.performedAt):'歌唱済み');
}
function historyRow(list,song,artist,status){const row=document.createElement('li'),title=document.createElement('div'),subtitle=document.createElement('div'),label=document.createElement('span');title.textContent=song;title.className='history-song';subtitle.textContent=artist;subtitle.className='history-artist';label.textContent=status;label.className='history-status';row.append(title,subtitle,label);list.append(row);}
async function refresh() {
  state = await api('/api/state');
  if(![state.round,state.round+1].includes(selectedRound))selectedRound=state.round;
  const token = tokens[`${selectedRound}:${selectedCategory}`] || tokens[selectedRound];
  mine = token ? (await api('/api/mine', { token })).entry : null;
  if(mine && (mine.round!==selectedRound || (mine.category||classifyArtist(mine.artist))!==selectedCategory))mine=null;
  mineToken=mine?token:null;
  const savedTokens=Object.values(tokens).slice(-100);
  myRequests=savedTokens.length?(await api('/api/my-requests',{method:'POST',data:{tokens:savedTokens}})).entries:[];
  render();
}
function chooseCategory(category){selectedCategory=category;$('artist').value='';$('song').value='';for(const kind of ['artist','song'])$(`${kind}-suggestions`).hidden=true;refresh().catch(error=>message(error.message,true));}
$('choose-yamapi').onclick=()=>chooseCategory('yamapi');$('choose-other').onclick=()=>chooseCategory('other');
$('choose-current').onclick=()=>{selectedRound=state.round;refresh().catch(error=>message(error.message,true));};
$('choose-next').onclick=()=>{selectedRound=state.round+1;refresh().catch(error=>message(error.message,true));};
$('request-form').addEventListener('submit', async event => {
  event.preventDefault(); $('submit').disabled = true; message('');
  try {
    const round=selectedRound, category=selectedCategory;
    const data = {...Object.fromEntries(new FormData(event.target)),round,category};
    const status = await api(`/api/song-status?${new URLSearchParams({artist:data.artist,song:data.song})}`);
    if(status.unknownAt){
      const formatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const reasons=status.reasons||[{reason:'unknown',at:status.unknownAt}];
      $('unknown-description').textContent=reasons.map(item=>item.reason==='no_audio'
        ? `${formatter.format(item.at)}時点では、この曲の音源がありませんでした。`
        : `${formatter.format(item.at)}時点では、えむぴーがこの曲をまだ覚えていませんでした。`).join('\n')+'\nそれでもリクエストしますか？';
      const dialog=$('unknown-warning');dialog.returnValue='';
      const confirmed=await new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='request'),{once:true});dialog.showModal();});
      if(!confirmed){$('song').focus();return;}
      data.unknownAcknowledgedAt=status.unknownAt;
    }
    mine = (await api('/api/requests', { method: 'POST', data, token: tokenFor(round,category) })).entry;
    safeSet('emupi-request-name', mine.name); $('song').value = ''; await refresh();
  } catch (error) { message(error.message, true); }
  finally { $('submit').disabled = false; }
});
$('rename').addEventListener('click', () => { $('rename-form').hidden = !$('rename-form').hidden; $('new-name').value = mine.name; if (!$('rename-form').hidden) $('new-name').focus(); });
$('rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try { mine = (await api('/api/mine', { method: 'PATCH', data: { name: $('new-name').value }, token: mineToken })).entry; safeSet('emupi-request-name', mine.name); $('name').value = mine.name; $('rename-form').hidden = true; await refresh(); message('名前を修正しました。'); }
  catch (error) { message(error.message, true); } finally { button.disabled = false; }
});
function suggest(kind) {
  for (const other of ['artist','song']) if(other !== kind) { $(`${other}-suggestions`).hidden=true; $(other).setAttribute('aria-expanded','false'); }
  const input = $(kind), box = $(`${kind}-suggestions`), value = normalize(input.value);
  box.replaceChildren();
  if (!value) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  let candidates;
  if (kind === 'artist') {
    candidates = [...new Map(items.filter(i => classifyArtist(i.artist)===selectedCategory && [i.artist, ...(i.artistAliases || [])].some(v => normalize(v).includes(value))).map(i => [i.artist, { label: i.artist }])).values()];
  } else {
    const a = normalize($('artist').value);
    const artists = new Set(items.filter(i => [i.artist, ...(i.artistAliases || [])].some(v => normalize(v) === a)).map(i => normalize(i.artist)));
    candidates = items.filter(i => classifyArtist(i.artist)===selectedCategory && (!a || artists.has(normalize(i.artist))) && [i.song, ...(i.aliases || [])].some(v => normalize(v).includes(value))).map(i => ({ label: `${i.song} · ${i.artist}`, item: i }));
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
