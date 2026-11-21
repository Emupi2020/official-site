// Song metadata only. No lyrics or audio. Sources and coverage: docs/CATALOG.md.
import { verifiedTitles } from './verified-titles.mjs';
import { appleTitles } from './apple-titles.mjs';
import { newsTitles } from './news-titles.mjs';
const yamapi = ['山P', '山ピー', 'やまぴー', 'やまぴ', 'やましたともひさ', 'Yamapi', 'Tomohisa Yamashita'];
const solo = [
  ['抱いてセニョリータ', 'だいてせにょりーた'], ['指輪', 'ゆびわ'], ['向日葵', 'ひまわり'],
  ['Loveless', 'らぶれす'], ['Run From You'], ['Me'], ['Moon Light'], ['After the Rain'], ['サンタマリア'], ['Crush On You'],
  ['One in a million', 'わんいんあみりおん'], ['口づけでアディオス'], ['My Dear'], ['World is yours'], ['Flavor Favor For You'],
  ['はだかんぼー'], ['Tokyo Sinfonietta'], ['Party Don’t Stop', "PARTY DON'T STOP"], ['One Girl'], ['Touch You'], ['最後のラブ・ソング'], ['Sleepwalking'], ['溺愛ROBOT'], ['罪と罰'], ['青'], ['Dekiai ROBO'], ['Friday Night'], ['TOMO'], ['MOLA'],
  ['愛、テキサス', 'あいてきさす'], ['Candy'], ['PERFECT CRIME'], ['LOVE CHASE', 'らぶちぇいす'], ['Inside, Outside'], ['君と風と三日月'],
  ['ERO -2012 version-'], ['カリーナ'], ['ロマンチック'], ['Shiver'], ['Hit the Wall'], ['BABY BABY'], ['Be The ONE'], ['僕だけの君に'], ['Turn Off The Lights'], ['悩みの森の真ん中で'], ['踊る夜'],
  ["怪・セラ・セラ", 'けせらせら'], ['そばにおいでよ'], ['Beating'], ['SUMMER NUDE ’13', 'さまーぬーど', "SUMMER NUDE '13"], ['Nocturne'], ['月の幻'],
  ['SING FOR YOU'], ['怪・セラ・セラ'], ['あの虹の向こうまで'], ['君の風になって'], ['原始的じゃナイト ～アナログ ラブ～'], ['NEXTACTION'], ['PAri-PArA'], ['MAGIC'], ['Stand Alone'], ['蜃気楼'], ['EVERYBODY UP'], ['パレード'],
  ['HELLO'], ['PARTY’S ON'], ['Mysterious'], ['Moon Disco'], ['Back to the dance floor'], ['Dress Code:'], ['Let It Go'],
  ['YOUR STEP'], ['いっしょ。'], ['今夜が革命前夜'], ['ブローディア'], ['アイスクリーム'], ['Anthem'], ['君の瞳の中に見えた丸くて青い星'], ['Love & Hug'], ['戻れないから'], ['大人のKiss英語'], ['B-A-N-G'],
  ['Dreamer'], ['UNUSUAL'], ['BIRD'], ['SUPER FUNKER!!'], ['MONSTERS'], ['UnleAsHed'], ['You Make Me'], ['Paraíso', 'Paraiso'], ['Right moves'], ['LOOK AT ME, LOOK AT ME'], ['秒針'], ['Dancer'], ['“H”', 'H'], ['StrAwbErry'], ['AI'], ['With you'], ['あの日の香り'],
  ['CHANGE', 'ちぇんじ'], ['Come around'], ['Nights Cold'], ['リナリア'], ['Basics'], ['Beautiful World', 'びゅーてぃふるわーるど'], ['Face To Face'], ['Forever in My Heart'], ['I See You', 'あいしーゆー'],
  ['Sweet Vision', 'すいーとびじょん'], ['Dancing in a Dream'], ['A Million Suns'], ['Sunrise'], ['Vision'], ['ONE'], ['I See You'], ['You & I'], ['花火'], ['Perfect Storm (feat. TAEHYUN of TOMORROW X TOGETHER)', 'Perfect Storm', 'ぱーふぇくとすとーむ'], ['The Artist', 'じあーてぃすと']
];
const units = [
  ['修二と彰', ['青春アミーゴ', 'せいしゅんあみーご']], ['亀と山P', ['背中越しのチャンス', 'せなかごしのちゃんす']], ['亀と山P', ['逆転レボルシオン']], ['亀と山P', ['Forever Summer']],
  ...['NEWSニッポン', '希望〜Yell〜', '紅く燃ゆる太陽', 'チェリッシュ', 'TEPPEN', 'サヤエンドウ', '裸足のシンデレラボーイ', '星をめざして', 'weeeek', '太陽のナミダ', 'SUMMER TIME', 'Happy Birthday', '恋のABO', 'さくらガール', 'Fighting Man', 'チャンカパーナ', 'LOVE SONG', 'SNOW EXPRESS', '恋のジュエット', 'ゴメンネ ジュリエット'].filter(s => s !== 'チャンカパーナ').map(s => ['NEWS', [s]])
];
const titleKey = value => value.normalize('NFKC').toLowerCase().replace(/[\s’'“”"・,〜～-]/g, '');
const cleanTitle = value => value.replace(/\((?:ドラマ|Hulu|映画).*$/, '').trim();
const sourcedSolo = [...new Map([...verifiedTitles,...appleTitles].map(cleanTitle).map(title=>[titleKey(title),title])).values()];
export const catalog = [...new Map([
  ...sourcedSolo.map(song => {
    const known = solo.find(([title]) => titleKey(title) === titleKey(song));
    return { artist: '山下智久', artistAliases: yamapi, song, aliases: known ? known.slice(1) : [] };
  }),
  ...units.map(([artist, [song, ...aliases]]) => ({ artist, artistAliases: [...yamapi, artist === 'NEWS' ? 'にゅーす' : artist], song, aliases })),
  ...newsTitles.map(song => ({artist:'NEWS',artistAliases:[...yamapi,'にゅーす'],song,aliases:[]}))
].map(row => [`${row.artist}:${titleKey(row.song)}`, row])).values()];
