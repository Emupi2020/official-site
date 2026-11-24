const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/[\s・･._\-’']/g,'');
const yamapiArtists = new Set(['山下智久','山P','山ピー','やまぴー','やまぴ','やましたともひさ','Yamapi','Tomohisa Yamashita','NEWS','にゅーす','修二と彰','亀と山P'].map(normalize));
export const classifyArtist = artist => yamapiArtists.has(normalize(artist)) ? 'yamapi' : 'other';
export const categoryOf = entry => classifyArtist(entry.artist);
export const categoryLabel = category => category==='yamapi'?'山Pの歌まね':'それ以外の歌まね';
