import { $ } from './common.mjs';
let angle = 0;
let labels = ['リクエストを待っています'];
const canvas = $('wheel'), ctx = canvas.getContext('2d');
function paint(rotation = angle) {
  const size = 800, center = size / 2, radius = center - 12;
  ctx.clearRect(0, 0, size, size);
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
export function settle(song, songs) {
  const target = placeWinner(song, songs);
  angle = target;
  paint();
}
function placeWinner(song, songs) {
  labels = [...songs.slice(0, 99), song];
  const winnerIndex = labels.length - 1;
  return -(winnerIndex + .5) * 2 * Math.PI / labels.length;
}
// After a short buildup, speed decays continuously to zero.
function spinProgress(t) {
  const remaining = 1 - t;
  return 1 - (5 * remaining ** 3 - remaining ** 15) / 4;
}
export async function spin(song, songs, duration) {
  const target = placeWinner(song, songs);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    angle = target;
    paint();
    return;
  }
  const from = angle;
  const fullTurn = 2 * Math.PI;
  const turns = Math.max(3, Math.round(duration / 650));
  const distance = fullTurn * turns + ((target - from) % fullTurn + fullTurn) % fullTurn;
  await new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      angle = from + distance * spinProgress(t);
      paint();
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
  angle = target;
}
paint();
