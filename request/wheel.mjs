import { $ } from './common.mjs';
let angle = 0;
let labels = ['リクエストを待っています'];
const canvas = $('wheel'), ctx = canvas.getContext('2d');
function paint(rotation = angle) {
  const size = 800, center = size / 2, radius = center - 12;
  canvas.width = size; canvas.height = size;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const colors = dark ? ['#173c69','#225794','#16304e','#24466e','#306baf','#25405c'] : ['#dceafe','#edf3fd','#bad7fb','#e4edf8','#caddf4','#f3f6fa'];
  const count = labels.length, arc = 2 * Math.PI / count;
  ctx.translate(center,center); ctx.rotate(rotation);
  labels.forEach((song,i) => {
    const start = i*arc - Math.PI/2;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,radius,start,start+arc);ctx.closePath();ctx.fillStyle=colors[i%colors.length];ctx.fill();ctx.strokeStyle=dark?'#0004':'#fff';ctx.lineWidth=3;ctx.stroke();
    ctx.save();ctx.rotate(start+arc/2);ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillStyle=dark?'#f5f5f7':'#1d1d1f';ctx.font=`500 ${count>18?19:25}px sans-serif`;const value = [...song];ctx.fillText(value.length>15?value.slice(0,14).join('')+'…':song,radius-28,0,Math.max(100,radius-110));ctx.restore();
  });
  ctx.setTransform(1,0,0,1,0,0);
}
export function setWheel(songs) { labels = songs.length ? songs.slice(0,100) : ['リクエストを待っています']; paint(); }
export function settle(song,songs) { labels=[...songs.slice(0,99),song];const index=labels.length-1;angle=-(index+.5)*2*Math.PI/labels.length;paint(); }
export async function spin(song, songs) {
  // Use the server-selected winner as a real segment. Never re-draw in the browser.
  const visual = songs.length ? songs.slice(0,100) : [song];
  let index = visual.indexOf(song);
  if(index<0){visual[visual.length-1]=song;index=visual.length-1;}
  labels=visual;
  const target = -(index+.5)*2*Math.PI/labels.length;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from=angle, full=2*Math.PI, end=from+full*5+((target-from)%full+full)%full;
  if(reduced){angle=end;paint();return;}
  await new Promise(resolve=>{const start=performance.now();function frame(now){const t=Math.min(1,(now-start)/3000);angle=from+(end-from)*(1-Math.pow(1-t,4));paint();if(t<1)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
}
paint();
