import { classifyArtist, categoryLabel } from './categories.mjs';
import { api, $, message, safeGet, safeSet, normalize, statusText } from './common.mjs';
let state, items=[], tokens, busy=false;
try { tokens=JSON.parse(safeGet('emupi-request-tokens')||'{}'); } catch { tokens={}; }
const slots=[...document.querySelectorAll('.request-slot')].map(root=>({root,id:root.id,category:root.dataset.category,reserved:root.dataset.reserved==='true',entry:null,token:null,round:null,draftRound:null}));
const field=(slot,name)=>$(`${slot.id}-${name}`);
const part=(slot,selector)=>slot.root.querySelector(selector);
$('name').value=safeGet('emupi-request-name')||'';
function tokenFor(round,category){const key=`${round}:${category}`;if(!tokens[key]){tokens[key]=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');safeSet('emupi-request-tokens',JSON.stringify(tokens));}return tokens[key];}
function lock(value){busy=value;for(const button of document.querySelectorAll('.slot-submit,.slot-rename-form button'))button.disabled=value;}
function feedback(slot,text){const box=part(slot,'.slot-feedback');box.textContent=text;box.hidden=!text;}
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
  part(slot,'.slot-form').hidden=!!slot.entry;part(slot,'.slot-receipt').hidden=!slot.entry;
  if(slot.entry){const mine=slot.entry;part(slot,'.slot-song').textContent=mine.song;part(slot,'.slot-artist').textContent=mine.artist;part(slot,'.slot-name').textContent=`${mine.name} さん`;part(slot,'.slot-status').textContent=slot.reserved&&mine.status==='pending'?'次回の抽選に入ります。':statusText[mine.status];part(slot,'.slot-rename').hidden=!mine.editable;}
 }
 for(const category of ['yamapi','other']){const current=slots.find(s=>s.category===category&&!s.reserved),nextSlot=slots.find(s=>s.category===category&&s.reserved);$(`reserve-${category}`).hidden=!current.entry&&!nextSlot.entry;}
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
 for(const candidate of candidates.slice(0,7)){const button=document.createElement('button');button.type='button';button.textContent=candidate.label;button.onclick=()=>{slot.draftRound??=slot.round;input.value=kind==='artist'?candidate.label:candidate.item.song;if(kind==='song'&&!field(slot,'artist').value)field(slot,'artist').value=candidate.item.artist;box.hidden=true;input.setAttribute('aria-expanded','false');input.focus();};box.append(button);}
 box.hidden=!box.children.length;input.setAttribute('aria-expanded',String(!box.hidden));
}
for(const slot of slots){
 const box=document.createElement('div');box.className='slot-feedback message error';box.hidden=true;box.setAttribute('role','status');slot.root.prepend(box);
 part(slot,'.slot-form').onsubmit=async event=>{
  event.preventDefault();if(busy||!state)return;if(!$('name').reportValidity())return;lock(true);feedback(slot,'');message('');
  try {const round=slot.draftRound??slot.round,data={...Object.fromEntries(new FormData(event.target)),name:$('name').value,round,category:slot.category};if(!await confirmSong(data)){field(slot,'song').focus();return;}
   const mine=(await api('/api/requests',{method:'POST',data,token:tokenFor(round,slot.category)})).entry;safeSet('emupi-request-name',mine.name);field(slot,'song').value='';slot.draftRound=null;await refresh();
  }catch(error){feedback(slot,error.message);if(error.status===409){slot.draftRound=null;await refresh().catch(()=>{});}}finally{lock(false);}
 };
 part(slot,'.slot-rename').onclick=()=>{const form=part(slot,'.slot-rename-form');form.hidden=!form.hidden;slot.renameToken=slot.token;field(slot,'new-name').value=slot.entry.name;if(!form.hidden)field(slot,'new-name').focus();};
 part(slot,'.slot-rename-form').onsubmit=async event=>{event.preventDefault();if(busy)return;lock(true);feedback(slot,'');try{const mine=(await api('/api/mine',{method:'PATCH',data:{name:field(slot,'new-name').value},token:slot.renameToken})).entry;safeSet('emupi-request-name',mine.name);$('name').value=mine.name;event.target.hidden=true;await refresh();}catch(error){feedback(slot,error.message);}finally{lock(false);}};
 for(const kind of ['artist','song']){const input=field(slot,kind);
  if (input.tagName === 'SELECT') {
   input.addEventListener('focus', () => hideSuggestions());
   input.addEventListener('change', () => {
    slot.draftRound ??= slot.round;
    field(slot, 'song').value = '';
    hideSuggestions();
    feedback(slot, '');
   });
   continue;
  }
  input.oninput=()=>{slot.draftRound??=slot.round;suggest(slot,kind);};input.onfocus=()=>hideSuggestions(input);input.onkeydown=event=>{const buttons=[...field(slot,`${kind}-suggestions`).querySelectorAll('button')];if(event.key==='ArrowDown'&&buttons.length){event.preventDefault();buttons[0].focus();}if(event.key==='Escape')hideSuggestions();};}
}
document.addEventListener('click',event=>{if(!event.target.closest('.sug-wrap'))hideSuggestions();});
try{await refresh();items=(await api('/api/suggestions')).items;message('');}catch(error){message(error.message,true);}
setInterval(()=>{if(!document.hidden&&!busy)refresh().catch(error=>message(error.message,true));},15000);
