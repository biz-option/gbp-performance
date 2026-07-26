# インフラ構築チェックリスト(手動作業用)

このドキュメントは、`gbp-performance` をローカルで動作確認するために **人間が手動で行う** GCP 上のセットアップ手順をまとめたものです。実際のリソース作成やシークレットの入力作業はコード(Claude)側では行いません。理由は、機密情報や本番インフラの変更を自動化・AI操作の対象から意図的に外しているためです。

作業順に上から進めてください。

## 1. Cloud SQL (MySQL) の準備

1. GCP Console から Cloud SQL for MySQL のインスタンスを作成する(認証方式は「組み込み認証」でよい)。
2. インスタンス内にデータベース(例: `gbp_performance`)を作成する。
3. Cloud SQL Studio(GCP Console内のブラウザSQLエディタ)に `root` ユーザー・インスタンス作成時のパスワードでログインする。
4. `root` でログインした状態で、アプリ専用のDBユーザーを作成する(`root` は初期セットアップ専用とし、アプリの日常的な接続には使わない):
   ```sql
   CREATE USER 'gbp_app'@'%' IDENTIFIED BY '強力なパスワードをここに';
   GRANT SELECT, INSERT, UPDATE, DELETE ON gbp_performance.* TO 'gbp_app'@'%';
   FLUSH PRIVILEGES;
   ```
   - パスワードは自分で生成し、Secret Managerと `.env` にのみ登録する(Claudeには共有しない)。
   - `DATABASE_URL` はURL形式のため、パスワードに `@` `:` `/` `#` `%` などの記号を含めると接続文字列があいまいになります。英数字のみのパスワードを生成するか、含める場合は該当文字をURLエンコードしてから `DATABASE_URL` に埋め込んでください。
5. `docs/schema.sql` の内容を、そのDBに対して手動で実行する(`root` のままで可)。
   - このファイルが今後もスキーマ変更のたびに更新される「正」のDDLです。
   - `prisma migrate` は使いません。スキーマ変更は必ずこのファイルを人間が確認した上で手動実行してください。
6. できあがった `gbp_app` ユーザーの接続情報を `DATABASE_URL` として使う(パスワードにURLエンコードが必要な文字が含まれる場合は、その状態で埋め込む):
   ```text
   mysql://gbp_app:<パスワード>@<接続先ホスト>:3306/gbp_performance
   ```

## 2. Secret Manager に登録するシークレット

このプロジェクトのアプリコードは、Secret Manager の値を実行時に直接APIで取得するのではなく、**デプロイ時に環境変数として注入される**ことを前提にしています(Cloud Run であれば `--set-secrets` オプションなど)。そのため、Secret Manager 側では以下のシークレットを作成し、対応する環境変数名にバインドしてください。

| Secret Manager 上のシークレット(例) | 対応する環境変数名 | 内容 |
|---|---|---|
| `gbp-performance-database-url` | `DATABASE_URL` | Cloud SQLへの接続文字列(`mysql://user:password@host:3306/gbp_performance`) |
| `gbp-performance-oauth-client-id` | `GOOGLE_OAUTH_CLIENT_ID` | OAuthクライアントID |
| `gbp-performance-oauth-client-secret` | `GOOGLE_OAUTH_CLIENT_SECRET` | OAuthクライアントシークレット |
| `gbp-performance-oauth-redirect-uri` | `GOOGLE_OAUTH_REDIRECT_URI` | OAuthリダイレクトURI |

各Googleアカウントのリフレッシュトークン(`google_oauth_credentials.refreshToken`)は環境変数ではなく、DBの当該テーブルに直接保存します(アカウントごとに複数存在しうるため)。

## 3. GCP Console — OAuth 同意画面・OAuthクライアントの作成

1. GCP Console の「APIとサービス」→「OAuth同意画面」を設定する(社内利用であれば「内部」でよい)。
2. 「認証情報」から OAuth クライアントIDを作成する。種類は **デスクトップアプリ** を推奨(ローカル検証用の `oauth-bootstrap` スクリプトが認可コードフローを使うため)。
3. 発行された クライアントID・クライアントシークレットを Secret Manager に登録する(上表参照)。
4. リダイレクトURIは、ローカル検証であれば `http://localhost:3000/oauth2callback` のような任意の値を設定し、`.env` の `GOOGLE_OAUTH_REDIRECT_URI` と一致させる。

## 4. Business Profile Performance API の有効化

GCP Console の「APIとサービス」→「ライブラリ」から **Business Profile Performance API** を有効化してください。有効化直後はクォータが0になっている場合があり、その場合はGoogleへのアクセス申請が別途必要です。

## 5. IAM(補足)

現在の設計(環境変数注入方式)では、アプリの実行環境自体が Secret Manager API を呼び出すことはないため、アプリ用サービスアカウントに Secret Manager への個別のIAM権限を付与する必要は基本的にありません。デプロイ時にシークレットを環境変数へ注入する仕組み(Cloud Run の `--set-secrets` 等)を使う場合、その注入処理自体に必要なIAM設定はGCPの標準手順に従ってください。

## 6. ローカル動作確認の一連の流れ

1. リポジトリルートに `.env` を作成し、`.env.example` を参考に値を入れる(Cloud SQLがローカルから接続可能である必要があります)。
2. `npm install`
3. `npm run oauth:bootstrap` を実行し、表示されるURLをブラウザで開いて認可 → 表示された `code` を入力する。
4. 画面に表示されたリフレッシュトークンを、`google_oauth_credentials` テーブルへ手動で `INSERT` する(`accountLabel` には任意の識別名を使う。このプロジェクトは単一Googleアカウントのみを前提としているため、この行は常に1件だけになる)。
5. `agencies` テーブルに代理店の行を作成する。各代理店は、対象ロケーションの権限を手順4のGoogleアカウントに共有してもらう運用を前提としている(代理店ごとに別のGoogleアカウント・credentialは扱わない)。
6. `locations` テーブルに、動作確認したいビジネスの行を手動で `INSERT` する(`agencyId` は手順5で作成した代理店のID)。
7. `npm run fetch:one-day -- --location=<googleLocationId> --date=YYYY-MM-DD --account=<accountLabel>` を実行する(1ロケーション・1日分の動作確認用)。
8. `daily_metrics` テーブルに行が保存されていることを確認する。
9. 複数ロケーションをまとめて確認したい場合は `npm run fetch:daily-batch` を実行する(全locationを巡回し、実行日の5日前までの未取得日をキャッチアップして取得する。使用するGoogleアカウントは `google_oauth_credentials` に登録された唯一の行から自動解決される。詳細は7章)。

## 7. 定期実行(Cloud Scheduler + Cloud Run Jobs)

`fetch-daily-batch` はHTTPサーバーを持たない実行完了型のバッチなので、Cloud Run **Job**(Serviceではない)としてデプロイし、Cloud Scheduler からその実行をキックする構成を想定しています。実際のリソース作成は本ドキュメントの他の章と同様、人間が手動で行ってください。

1. **コンテナイメージのビルド・push**(リポジトリルートの `Dockerfile` を使用)
   ```text
   gcloud artifacts repositories create gbp-performance --repository-format=docker --location=<region>
   docker build -t <region>-docker.pkg.dev/<project>/gbp-performance/fetch-daily-batch:latest .
   docker push <region>-docker.pkg.dev/<project>/gbp-performance/fetch-daily-batch:latest
   ```
2. **Cloud Run Job の作成**(環境変数の注入方法は2章のSecret Managerと同じ `--set-secrets` を使う)
   ```text
   gcloud run jobs create fetch-daily-batch \
     --image=<region>-docker.pkg.dev/<project>/gbp-performance/fetch-daily-batch:latest \
     --region=<region> \
     --set-secrets="DATABASE_URL=gbp-performance-database-url:latest,\
GOOGLE_OAUTH_CLIENT_ID=gbp-performance-oauth-client-id:latest,\
GOOGLE_OAUTH_CLIENT_SECRET=gbp-performance-oauth-client-secret:latest,\
GOOGLE_OAUTH_REDIRECT_URI=gbp-performance-oauth-redirect-uri:latest"
   ```
3. **Cloud Scheduler からJobを起動するためのサービスアカウント**を作成し、そのJobに対して `roles/run.invoker` を付与する。
4. **Cloud Scheduler ジョブの作成**。ターゲットはHTTP、Cloud Run Admin API の `jobs.run` エンドポイントを叩き、認証は手順3のサービスアカウントによるOIDCトークンを使う。
   ```text
   gcloud scheduler jobs create http fetch-daily-batch-trigger \
     --location=<region> \
     --schedule="0 18 * * *" \
     --time-zone="Asia/Tokyo" \
     --uri="https://run.googleapis.com/v2/projects/<project>/locations/<region>/jobs/fetch-daily-batch:run" \
     --http-method=POST \
     --oauth-service-account-email=<scheduler用サービスアカウント>
   ```
   スケジュール(`--schedule`)は例です。データ取得対象日は実行日の5日前で固定計算されるため、1日1回実行すれば十分です。
5. Cloud Run Job の実行ログ(成功/失敗件数、スキップしたlocation)は標準出力に出るため、Cloud Logging で確認できます。

## 未確定・将来の課題

- 上記の Cloud Scheduler / Cloud Run Job 設定は手順としてドキュメント化したのみで、実際の作成(gcloudコマンドの実行)はまだ行われていません。
- `fetch-daily-batch` は「単一Googleアカウントのみを前提とする」設計です(`google_oauth_credentials` に2件以上登録されているとエラーで停止する)。将来、代理店ごとに別のGoogleアカウントを使う運用に変わった場合は設計の見直しが必要です。
