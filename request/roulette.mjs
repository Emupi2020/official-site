import { api, $, message } from './common.mjs';
import { setWheel, spin, settle } from './wheel.mjs';
let previous, songs=[], busy=false;
async function refresh(){
  if(busy||document.hidden)return;busy=true;
  try{
    const state=await api('/api/state');message('');
    const key=state.result?`${state.result.id}:${state.result.drawnAt}`:null;
    if(previous!==undefined && key && key!==previous){$('result').hidden=true;await spin(state.result.song,songs);}
    previous=key;songs=state.candidates.map(e=>e.song);if(state.result)settle(state.result.song,songs);else setWheel(songs);
    $('result').hidden=!state.result;if(state.result){$('result-song').textContent=state.result.song;$('result-artist').textContent=state.result.artist;}
  }catch(error){message(error.message,true);}finally{busy=false;}
}
await refresh();setInterval(refresh,5000);
