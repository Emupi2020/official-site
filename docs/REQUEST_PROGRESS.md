# 実装・検証記録

2026年11月22日

## 完了

- 公式サイトからソースを取得。専用ブランチ `codex/song-request` で作業。
- 応募・本人による名前訂正・管理・公開ルーレットの画面を作成。
- 受付回ごとの重複制限、途中参加、同曲の別口抽選、歌唱後の次回保留、受付回／配信の切り替え、取り消しを実装。
- 初期候補242件と自由入力からの自動候補追加を実装。
- SQLite実DBを含む16テストが通過。重複送信8件の競合で1件だけ成功することを確認。
- ブラウザで390px幅の応募、ひらがなサジェスト、自由入力、管理への反映、ルーレット停止結果、応募者名の公開／非公開の違いを確認。
- Workerの配備用ビルドを確認。専用D1をAPACに作成し、今回のmigrationを適用。
- 専用Workerを配備。受付は閉じた初期状態。SESSION_SECRETはCloudflare Secretsで保存。
- 本番の公開APIで受付終了・応募0件、未ログイン管理APIで401を確認。

## 公開先

- 応募：https://emupi-requests.pokeca-lottery-manager.workers.dev/
- 管理：https://emupi-requests.pokeca-lottery-manager.workers.dev/admin/
- 公開ルーレット：https://emupi-requests.pokeca-lottery-manager.workers.dev/roulette.html
- 公式サイト内への組込み予定：https://emupi2020.github.io/official-site/request/

公式サイトの公開ブランチにはまだ反映していない。管理者のGoogleアカウント指定、Google OAuthクライアントID／Secretの設定と実ログイン確認が必要。

## ローカルの画面記録

- `output/playwright/listener-mobile.png`
- `output/playwright/admin-mobile.png`（初回撮影はデスクトップ幅。名称にかかわらず撮影内容で判断する）
- `output/playwright/roulette-public.png`

## 残件

- 管理者本人のGoogleアカウントとGoogle OAuthクライアント設定。認証の実接続は未確認。
- 楽曲の全バージョン・限定盤などの網羅確認。収録済みの範囲はCATALOG.mdに記載。
- GitHub Pages公開後のクロスオリジンでの応募・名前修正の実機確認。
- 課金管理画面での契約・余裕枠確認はまだ行っていない。有料プランへの変更はしていない。

## 初期設定として仮置きした値

応募履歴は30日、同一の短期アクセス識別子からの送信は1分20回まで、配信名50文字、歌手／曲名100文字まで。これらは運用を見て変更できる。
