# 楽曲候補の出典と収録範囲

確認日：2026年11月22日。歌詞・音源・ジャケットは保存せず、歌手名・曲名だけを使う。

## 取得済み

- UtaTen 山下智久の曲名一覧：116件。曲名リンクの最初の表示だけを抽出し、歌詞の抜粋は保存しない。
  https://utaten.com/artist/lyric/8641?sort=release_date_asc
- Apple公式iTunes Search API：artistId=1583899620 の曲を照合。InstrumentalとRemixを除いた26件の異なる表記を取り込む。
  https://itunes.apple.com/search?term=Tomohisa%20Yamashita&country=jp&entity=song&limit=200
- `verified-titles.mjs` と `apple-titles.mjs` が取得した曲名。`catalog.mjs` で表記重複を整理し、読み方と通称を追加する。
- NEWSの在籍時4アルバム（touch、pacific、color、LIVE）と当時の14シングル／EPを、Apple公式メタデータで追加照合。音源なし版を除く曲名102件を取り込む。
  https://itunes.apple.com/lookup?id=1769382353,1769385620,1769388519,1765464702,1765460805,1769381293,1765460353,1765464654,1765460596,1765461651,1765460640,1765466483,1765465506,1765460971,1765461124,1765461108,1765503504,1765465391&country=jp&entity=song&limit=200
- 初期候補は山下智久ソロ134件、NEWS104件、修二と彰1件、亀と山P3件、合計242件。候補の件数は「全作品の網羅を証明した曲数」ではない。

## 公式との照合

- 本人公式ディスコグラフィー：https://tomohisayamashita.com/discography/
- DREAMING本人公式ストア：https://store.plusmember.jp/tomohisayamashita/products/detail.php?product_id=114191
- UNLEASHED／Sony Music：https://sonymusic.com.tw/album/tomohisa-yamashita-unleashed-standard-edition/
- SUPERGOOD, SUPERBAD／ELOV：https://www.elov-label.jp/s/el/discography/JECN-0252
- 背中越しのチャンス／STARTO：https://starto.jp/s/p/discography/JACA-5657_8?artist=10
- NEWS touch／ELOV：https://www.elov-label.jp/s/el/discography/JECN-0069
- NEWS pacific／ELOV：https://www.elov-label.jp/s/el/discography/JECN-0150
- DREAMINGの9曲を照合した販売店：https://joshinweb.jp/dp/4570278960055.html

## 残る確認

各CDの限定盤だけに入った曲、他名義の客演曲、未音源化曲、別バージョンの完全照合は未完了。NEWSは上記18作品のApple配信収録曲を取得済みだが、全CD版との差分照合は別。初期版の候補は上記242件で、ここを「山Pの全曲登録完了」とは扱わない。候補になくても自由入力で応募でき、その入力が次から候補に加わる。

表記の近さだけでは勝手に別の曲を統合しない。読みを追加する場合も曲単位で関連付ける。
