# gbp-performance

Google Business Profile (GBP) のパフォーマンスデータを Google API 経由で取得し、DBに保存するためのスクリプト群です。

## このプロジェクトのスコープ

- Google Business Profile Performance API からのデータ取得
- 取得したデータのDB(Cloud SQL / MySQL)への保存
- 全ロケーションを巡回して定期取得するバッチ本体(`fetch-daily-batch`)、およびそれをCloud Run Job
  としてデプロイするための `Dockerfile`

以下は**このプロジェクトの対象外**です:

- 取得したデータのレポート化・可視化(Google データソースなど)
- 代理店担当者向けの報告機能
- Cloud Scheduler / Cloud Run Job の実際のリソース作成(手順は [`docs/infra.md`](docs/infra.md) に
  ドキュメント化済みだが、実際の `gcloud` 実行は人間が手動で行う)

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

## 全ロケーションの定期取得(バッチ)

```bash
npm run fetch:daily-batch
```

全locationを巡回し、「実行日の5日前」までの未取得日をキャッチアップして取得する。使用するGoogleアカウントは `google_oauth_credentials` に登録された唯一の行から自動解決される(このプロジェクトは単一Googleアカウントのみを前提としており、代理店側が対象ロケーションの権限をこのアカウントに共有する運用)。あるlocationが非0のメトリクスを取得できた場合、その代理店の `confirmedThroughDate`(この日付以前は確定済みとみなせるウォーターマーク)を自動的に前進させる。

このバッチをCloud Scheduler + Cloud Run Job で定期実行する手順は [`docs/infra.md`](docs/infra.md) の「定期実行」章を参照してください。

## ディレクトリ構成

```
src/
  config/    環境変数の読み込み(Secret Managerの値はデプロイ時に環境変数へ注入される想定)
  google/    OAuth認可・Performance API呼び出し・メトリクス変換・取得〜保存のオーケストレーション・バッチ巡回
  db/        Prisma Client・リポジトリ層
prisma/      Prismaスキーマ(docs/schema.sqlと手動同期)
docs/        DBスキーマ(手動実行用DDL)・インフラ構築手順
scripts/     手動実行するCLI(OAuthトークン取得・1日分データ取得・全ロケーション巡回バッチ)
test/        Vitestによる単体テスト
Dockerfile   fetch-daily-batch をCloud Run Jobとして動かすためのイメージ定義
```
