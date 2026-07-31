# インフラ構築チェックリスト(手動作業用)

`gbp-performance` のローカル動作確認に必要な GCP セットアップ手順です。機密情報や本番インフラの変更を自動化・AI操作の対象から外すため、**人間が手動で**作業順に進めてください。

## 1. Cloud SQL (MySQL) の準備

1. GCP Console から Cloud SQL for MySQL のインスタンスを作成する(認証方式は「組み込み認証」でよい)。
2. インスタンス内にデータベース(例: `gbp_performance`)を作成する。
3. Cloud SQL Studio に `root` ユーザーでログインする。
4. アプリ専用のDBユーザーを作成する(`root` は初期セットアップ専用とし、アプリの日常的な接続には使わない):
   ```sql
   CREATE USER 'gbp_app'@'%' IDENTIFIED BY '強力なパスワードをここに';
   GRANT SELECT, INSERT, UPDATE, DELETE ON gbp_performance.* TO 'gbp_app'@'%';
   FLUSH PRIVILEGES;
   ```
   - パスワードは自分で生成し、Secret Managerと `.env` にのみ登録する(Claudeには共有しない)。
   - `DATABASE_URL` はURL形式のため、パスワードに `@` `:` `/` `#` `%` などの記号を含めると接続文字列があいまいになります。英数字のみのパスワードを生成するか、含める場合は該当文字をURLエンコードしてから `DATABASE_URL` に埋め込んでください。
5. `docs/schema.sql` の内容を、そのDBに対して手動で実行する(`root` のままで可)。
   - スキーマ変更の正となるDDLファイルです。`prisma migrate` は使わず、変更時は必ず人間が確認した上で手動実行してください。
6. `gbp_app` ユーザーの接続情報を `DATABASE_URL` として使う:
   ```text
   mariadb://gbp_app:<パスワード>@<接続先ホスト>:3306/gbp_performance?allowPublicKeyRetrieval=true
   ```
   - `allowPublicKeyRetrieval=true` が無いと、MySQL8のデフォルト認証方式(`caching_sha2_password`)がSSL無し接続でRSA公開鍵を取得できず、`RSA public key is not available client side` エラーになる。

## 2. Secret Manager に登録するシークレット

アプリはSecret Managerの値をAPIで直接取得せず、**デプロイ時に環境変数として注入される**前提です(Cloud Run の `--set-secrets` など)。以下のシークレットを作成し、対応する環境変数名にバインドしてください。

| Secret Manager 上のシークレット(例) | 対応する環境変数名 | 内容 |
|---|---|---|
| `gbp-performance-database-url` | `DATABASE_URL` | Cloud SQLへの接続文字列(`mariadb://user:password@host:3306/gbp_performance?allowPublicKeyRetrieval=true`) |
| `gbp-performance-oauth-client-id` | `GOOGLE_OAUTH_CLIENT_ID` | OAuthクライアントID |
| `gbp-performance-oauth-client-secret` | `GOOGLE_OAUTH_CLIENT_SECRET` | OAuthクライアントシークレット |
| `gbp-performance-oauth-redirect-uri` | `GOOGLE_OAUTH_REDIRECT_URI` | OAuthリダイレクトURI |

各Googleアカウントのリフレッシュトークン(`google_oauth_credentials.refreshToken`)は環境変数ではなく、DBの当該テーブルに直接保存します(アカウントごとに複数存在しうるため)。

## 3. GCP Console — OAuth 同意画面・OAuthクライアントの作成

1. GCP Console の「APIとサービス」→「OAuth同意画面」を設定する(社内利用であれば「内部」でよい)。
2. 「認証情報」から OAuth クライアントIDを作成する。種類は **デスクトップアプリ** を推奨(`oauth-bootstrap` スクリプトが認可コードフローを使うため)。
3. 発行されたクライアントID・シークレットを Secret Manager に登録する(上表参照)。
4. リダイレクトURIは、ローカル検証であれば `http://localhost:3000/oauth2callback` のような値を設定し、`.env` の `GOOGLE_OAUTH_REDIRECT_URI` と一致させる。

## 4. Business Profile Performance API の有効化

GCP Console の「APIとサービス」→「ライブラリ」から **Business Profile Performance API** を有効化してください。有効化直後はクォータが0の場合があり、その際はGoogleへのアクセス申請が別途必要です。

## 5. IAM(補足)

Cloud Run Job/Service を `--set-secrets` でデプロイする場合、その実行サービスアカウントに対して各シークレットへの `roles/secretmanager.secretAccessor` を付与する必要があります(GCPが起動時にシークレット値を取得して環境変数へ注入するため)。付与方法はGCPの標準手順に従ってください。

## 6. ローカル動作確認の一連の流れ

1. リポジトリルートに `.env` を作成し、`.env.example` を参考に値を入れる(Cloud SQLがローカルから接続可能である必要があります)。
2. `npm install`
3. `npm run oauth:bootstrap` を実行し、表示されるURLをブラウザで開いて認可 → 表示された `code` を入力する。
4. 表示されたリフレッシュトークンを `google_oauth_credentials` テーブルへ手動で `INSERT` する(`accountLabel` は任意の識別名。単一Googleアカウント前提のため、この行は常に1件のみ)。
5. `agencies` テーブルに代理店の行を作成する。各代理店は、対象ロケーションの権限を手順4のGoogleアカウントに共有してもらう運用(代理店ごとに別アカウント・credentialは扱わない)。
6. `locations` テーブルに、動作確認したいビジネスの行を手動で `INSERT` する(`agencyId` は手順5で作成した代理店のID)。
7. `npm run fetch:one-day -- --location=<googleLocationId> --date=YYYY-MM-DD --account=<accountLabel>` を実行する(1ロケーション・1日分の動作確認用)。
8. `daily_metrics` テーブルに行が保存されていることを確認する。
9. 複数ロケーションをまとめて確認したい場合は `npm run fetch:daily-batch` を実行する(全locationを巡回し、実行日の5日前までの未取得日をキャッチアップ。使用するGoogleアカウントは `google_oauth_credentials` の唯一の行から自動解決。詳細は7章)。

## 7. 定期実行(Cloud Scheduler + Cloud Run Jobs)

`fetch-daily-batch` はHTTPサーバーを持たない実行完了型バッチなので、Cloud Run **Job**(Serviceではない)としてデプロイし、Cloud Scheduler からキックする構成を想定しています。実際のリソース作成は他の章と同様、人間が手動で行ってください。

1. **コンテナイメージのビルド・push**(リポジトリルートの `Dockerfile` を使用)
   - Apple Silicon Mac等でビルドする場合、`--platform linux/amd64` を付けないとCloud Runが受け付けないイメージ(arm64)になるので注意。
   ```text
   gcloud artifacts repositories create gbp-performance --repository-format=docker --location=asia-northeast1
   docker build --platform linux/amd64 -t asia-northeast1-docker.pkg.dev/oaky-gmb/gbp-performance/fetch-daily-batch:latest .
   docker push asia-northeast1-docker.pkg.dev/oaky-gmb/gbp-performance/fetch-daily-batch:latest
   ```
2. **Cloud SQLへの接続方式について**: この構成(VPCコネクタ/Direct VPC egress + Cloud NATによる送信IP固定を組んでいない)では送信IPが固定されないため、Cloud SQLの「承認済みネットワーク」によるIP許可リストでは接続できない。代わりにCloud SQL Auth Proxy(Unixソケット)経由で接続する(アプリコード側は `CLOUD_SQL_CONNECTION_NAME` 環境変数が設定されているとソケット接続に自動的に切り替わる。`src/db/prismaClient.ts` 参照)。
   - Cloud Run Jobの実行サービスアカウント(デフォルトは `<プロジェクト番号>-compute@developer.gserviceaccount.com`)に `roles/cloudsql.client` を付与しておく。
   ```text
   gcloud sql instances describe gbp-performance-sql-instance --format="value(connectionName)"
   ```
3. **Cloud Run Job の作成**(環境変数の注入方法は2章のSecret Managerと同じ `--set-secrets` を使う。`--set-cloudsql-instances` でCloud SQL Auth Proxyの接続を有効化し、`CLOUD_SQL_CONNECTION_NAME` にその接続名を渡す)
   ```text
   gcloud run jobs create fetch-daily-batch \
     --image=asia-northeast1-docker.pkg.dev/oaky-gmb/gbp-performance/fetch-daily-batch:latest \
     --region=asia-northeast1 \
     --set-cloudsql-instances=oaky-gmb:asia-northeast1:gbp-performance-sql-instance \
     --set-env-vars="CLOUD_SQL_CONNECTION_NAME=oaky-gmb:asia-northeast1:gbp-performance-sql-instance" \
     --set-secrets="DATABASE_URL=gbp-performance-database-url:latest,\
GOOGLE_OAUTH_CLIENT_ID=gbp-performance-oauth-client-id:latest,\
GOOGLE_OAUTH_CLIENT_SECRET=gbp-performance-oauth-client-secret:latest,\
GOOGLE_OAUTH_REDIRECT_URI=gbp-performance-oauth-redirect-uri:latest"
   ```
   既存のJobを更新する場合は `create` の代わりに `update` を使う(オプションは同じ)。
4. **Cloud Scheduler からJobを起動するためのサービスアカウント**を作成し、そのJobに対して `roles/run.invoker` を付与する。
5. **Cloud Scheduler ジョブの作成**。ターゲットはHTTP、Cloud Run Admin API の `jobs.run` エンドポイントを叩き、認証は手順4のサービスアカウントによるOIDCトークンを使う。
   ```text
   gcloud scheduler jobs create http fetch-daily-batch-trigger \
     --location=<region> \
     --schedule="0 18 * * *" \
     --time-zone="Asia/Tokyo" \
     --uri="https://run.googleapis.com/v2/projects/oaky-gmb/locations/<region>/jobs/fetch-daily-batch:run" \
     --http-method=POST \
     --oauth-service-account-email=<scheduler用サービスアカウント>
   ```
   スケジュール(`--schedule`)は例です。データ取得対象日は実行日の5日前で固定計算されるため、1日1回実行すれば十分です。
6. Cloud Run Job の実行ログ(成功/失敗件数、スキップしたlocation)は標準出力に出るため、Cloud Logging で確認できます。

## 未確定・将来の課題

- 上記の Cloud Scheduler / Cloud Run Job 設定は実際に作成済み(`fetch-daily-batch` Job、`fetch-daily-batch-trigger` Scheduler)。手動実行での動作確認は完了しているが、Scheduler経由の自動実行(毎日18:00 JST)はまだ実績がないため、初回実行後にログを確認すること。
- `fetch-daily-batch` は「単一Googleアカウントのみを前提とする」設計です(`google_oauth_credentials` に2件以上登録されているとエラーで停止する)。将来、代理店ごとに別のGoogleアカウントを使う運用に変わった場合は設計の見直しが必要です。
