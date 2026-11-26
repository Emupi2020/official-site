import { normalize } from './categories.mjs?v=kana';
import { catalog } from './catalog.mjs';

const catalogArtistAliases = new Map();
const catalogSongAliases = new Map();
for (const {artist, artistAliases, song, aliases} of catalog) {
 const artistKey = normalize(artist);
 const names = catalogArtistAliases.get(artistKey) || new Set();
 for (const alias of artistAliases || []) names.add(alias);
 catalogArtistAliases.set(artistKey, names);
 catalogSongAliases.set(songKey(artist, song), aliases || []);
}

const artistReadings = new Map([
 ['星野源', 'ほしのげん'], ['米津玄師', 'よねづけんし'], ['宇多田ヒカル', 'うただひかる'],
 ['椎名林檎', 'しいなりんご'], ['福山雅治', 'ふくやままさはる'], ['平井堅', 'ひらいけん'],
 ['秦基博', 'はたもとひろ'], ['中島美嘉', 'なかしまみか'], ['中島みゆき', 'なかじまみゆき'],
 ['木村拓哉', 'きむらたくや'], ['山下達郎', 'やましたたつろう'], ['嵐', 'あらし'],
 ['修二と彰', 'しゅうじとあきら'], ['亀と山P', 'かめとやまぴー'],
].map(([name, reading]) => [normalize(name), reading]));

const songReadings = new Map([
 ['星野源', '恋', 'こい'], ['星野源', '喜劇', 'きげき'], ['星野源', '不思議', 'ふしぎ'],
 ['山下智久', '青', 'あお'], ['山下智久', '秒針', 'びょうしん'], ['山下智久', '花火', 'はなび'],
 ['山下智久', '罪と罰', 'つみとばつ'], ['山下智久', '蜃気楼', 'しんきろう'],
 ['山下智久', 'Reason', 'りーずん'], ['山下智久', 'With You', 'うぃずゆー'],
 ['山下智久', 'MOLA', 'もら'], ['山下智久', 'MOLA (R-midwest REMIX)', 'もら'],
 ['NEWS', '恋のABO', 'こいのえーびーおー'], ['NEWS', '星をめざして', 'ほしをめざして'],
 ['亀と山P', '逆転レボルシオン', 'ぎゃくてんれぼるしおん'],
 ['宇多田ヒカル', '花束を君に', 'はなたばをきみに'],
 ['米津玄師', 'Lemon', 'れもん'], ['米津玄師', '馬と鹿', 'うまとしか'],
].map(([artist, song, reading]) => [songKey(artist, song), reading]));

const koreanSongReadings = new Map([
 ['山下智久', '青', '아오'],
 ['山下智久', '花火', '하나비'],
 ['山下智久', '秒針', '뵤신'],
 ['山下智久', '蜃気楼', '신키로'],
 ['山下智久', 'Loveless', '러브리스', '러블리스'],
 ['山下智久', 'Reason', '리즌'],
 ['山下智久', 'With You', '위드 유'],
 ['山下智久', 'MOLA', '모라', '몰라'],
 ['山下智久', 'MOLA (R-midwest REMIX)', '모라', '몰라'],
 ['山下智久', '怪・セラ・セラ', '케세라세라'],
 ['星野源', '恋', '코이', '고이'],
 ['星野源', '喜劇', '키게키', '기게키'],
 ['星野源', '不思議', '후시기'],
 ['修二と彰', '青春アミーゴ', '세이슌 아미고'],
 ['米津玄師', 'Lemon', '레몬'],
 ['米津玄師', '馬と鹿', '우마토 시카'],
 ['宇多田ヒカル', '花束を君に', '하나타바오 키미니'],
].map(([artist, song, ...readings]) => [songKey(artist, song), readings]));

function songKey(artist, song) {
 return normalize(artist) + ':' + normalize(song);
}

export function artistSearchNames(item) {
 const key = normalize(item.artist);
 return [item.artist, ...(item.artistAliases || catalogArtistAliases.get(key) || []), artistReadings.get(key)];
}

export function songSearchNames(item) {
 const key = songKey(item.artist, item.song);
 return [item.song, ...(item.aliases || catalogSongAliases.get(key) || []), songReadings.get(key), ...(koreanSongReadings.get(key) || [])];
}
