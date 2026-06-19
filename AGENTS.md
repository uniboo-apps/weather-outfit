# きょうの服装ナビ（weather-outfit）

現在地（または検索した地名）の天気に応じて、今日の服装を提案する Web アプリ。暑がり/寒がりのトグルあり。

## 構成・技術
- **`index.html` 1枚で完結**（静的）。
- 使用API（すべて**キー不要の公開API**）：
  - 天気：`open-meteo.com`（forecast）
  - 地名検索：`geocoding-api.open-meteo.com`
  - 逆ジオコーディング：`api.bigdatacloud.net`（reverse-geocode-client）

## デプロイ
- `main` に push → GitHub Actions で Cloudflare Pages へ自動デプロイ。
- **本番 URL**: https://weather-outfit-7uc.pages.dev
- リポジトリは **public**（`uniboo-apps` の組織シークレット使用）。
- ※ Netlify の `neon-wisp-c867d9.netlify.app` は旧URL（廃止）。

## ルール
- **public なので秘密（APIキー等）をコードに置かない**。現状すべてキー不要APIなので問題なし。
- モバイル前提（位置情報の許可、タップUI、`safe-area`）。
