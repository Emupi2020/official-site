import { initialState, submit, rename, receipt, publicState, adminAction, songStatus } from './demo-domain.mjs';
import { catalog } from './catalog.mjs';
const prefix='emupi-demo-v1:', stateKey=prefix+'state';
function fresh(){
  const state=initialState();state.open=true;
  submit(state,{name:'サンプルA',artist:'山下智久',song:'Loveless'},'sample-a');
  submit(state,{name:'サンプルB',artist:'山下智久',song:'Loveless'},'sample-b');
  submit(state,{name:'サンプルC',artist:'修二と彰',song:'青春アミーゴ'},'sample-c');
  return state;
}
let memory;
function load(){try{const saved=localStorage.getItem(stateKey);if(saved)return JSON.parse(saved);}catch{}return memory||fresh();}
function save(state){memory=state;try{localStorage.setItem(stateKey,JSON.stringify(state));}catch{}}
save(load());
window.EMUPI_DEMO={storagePrefix:prefix,async request(path,{method='GET',data,token}={}){
  const state=load();
  if(path==='/api/state')return publicState(state);
  if(path.startsWith('/api/song-status?')){const query=new URL(path,location.origin).searchParams;return songStatus(state,query.get('artist'),query.get('song'));}
  if(path==='/api/suggestions')return{items:[...catalog,...state.suggestions.map(s=>({artist:s.artist,song:s.song}))]};
  if(path==='/api/admin'&&method==='GET')return structuredClone(state);
  if(path==='/api/admin'&&method==='POST'){adminAction(state,data);save(state);return{ok:true};}
  if(path==='/api/requests'&&method==='POST'){submit(state,data,token);save(state);return{entry:receipt(state,token)};}
  if(path==='/api/mine'&&method==='PATCH'){
    const entry=state.entries.findLast(e=>e.tokenHash===token);
    if(!entry)throw new Error('リクエストが見つかりません。');
    rename(state,entry,data.name);save(state);return{entry:receipt(state,token)};
  }
  if(path==='/api/mine')return{entry:receipt(state,token)};
  throw new Error('テスト版ではこの操作は使えません。');
}};
const requested=new URL(location.href).searchParams.get('view')||'admin';
const view=['request','admin','roulette'].includes(requested)?requested:'admin';
for(const a of document.querySelectorAll('[data-view]'))if(a.dataset.view===view)a.setAttribute('aria-current','page');
document.getElementById('demo-reset').onclick=()=>{
  if(!confirm('この端末のテストデータを初期状態に戻しますか？'))return;
  try{for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);}catch{}
  memory=null;location.reload();
};
try{
  const file={request:'index.html',admin:'admin.html',roulette:'roulette.html'}[view];
  const response=await fetch(new URL(file,import.meta.url));
  if(!response.ok)throw new Error('テスト画面を読み込めませんでした。');
  const template=new DOMParser().parseFromString(await response.text(),'text/html');
  const main=template.querySelector('main');
  if(!main)throw new Error('テスト画面が見つかりません。');
  document.getElementById('demo-root').replaceChildren(document.importNode(main,true));
  if(view==='admin'){
    document.getElementById('logout').hidden=true;
    document.querySelector('a[href="/roulette.html"]').href='./demo.html?view=roulette';
  }
  await import({request:'./listener.mjs',admin:'./admin.mjs',roulette:'./roulette.mjs'}[view]);
}catch(error){document.getElementById('demo-root').textContent=error.message;}
