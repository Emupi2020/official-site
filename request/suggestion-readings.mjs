import { normalize } from './categories.mjs';

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

function songKey(artist, song) {
 return normalize(artist) + ':' + normalize(song);
}

export function artistSearchNames(item) {
 return [item.artist, ...(item.artistAliases || []), artistReadings.get(normalize(item.artist))];
}

export function songSearchNames(item) {
 return [item.song, ...(item.aliases || []), songReadings.get(songKey(item.artist, item.song))];
}
