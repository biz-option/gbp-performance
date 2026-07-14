# gbp-performance

Google Business Profile (GBP) のパフォーマンスデータを Google API 経由で取得し、DBに保存するためのスクリプト群です。

## このプロジェクトのスコープ

- Google Business Profile Performance API からのデータ取得
- 取得したデータのDB(Cloud SQL / MySQL)への保存

以下は**このプロジェクトの対象外**です:

- 取得したデータのレポート化・可視化(Google データソースなど)
- 代理店担当者向けの報告機能
- Cloud Scheduler 等による定期実行(将来別途検討)
- 0件フラグ・再試行を伴う3日後取得のバッチ照合ロジック(将来別途検討)

## セットアップ

インフラ(Cloud SQL、Secret Manager、OAuthクライアント等)の手動構築手順は [`docs/infra.md`](docs/infra.md) を参照してください。

DBスキーマ(手動実行用DDL)は [`docs/schema.sql`](docs/schema.sql) にあります。`prisma/schema.prisma` はこのファイルと手動で同期しています。`prisma migrate` は使用しません。

```bash
npm install
cp .env.example .env   # 値は docs/infra.md の手順に沿って手動で入力する
npm run typecheck
npm test
```

## ローカルでの動作確認(1ロケーション・1日分のデータ取得)

```bash
npm run oauth:bootstrap
# 表示されたリフレッシュトークンを google_oauth_credentials テーブルへ手動登録

npm run fetch:one-day -- --location=<googleLocationId> --date=YYYY-MM-DD --account=<accountLabel>
```

詳細な手順は [`docs/infra.md`](docs/infra.md) の「ローカル動作確認の一連の流れ」を参照してください。

## ディレクトリ構成

```
src/
  config/    環境変数の読み込み(Secret Managerの値はデプロイ時に環境変数へ注入される想定)
  google/    OAuth認可・Performance API呼び出し・メトリクス変換・取得〜保存のオーケストレーション
  db/        Prisma Client・リポジトリ層
prisma/      Prismaスキーマ(docs/schema.sqlと手動同期)
docs/        DBスキーマ(手動実行用DDL)・インフラ構築手順
scripts/     手動実行するCLI(OAuthトークン取得・1日分データ取得)
test/        Vitestによる単体テスト
```
