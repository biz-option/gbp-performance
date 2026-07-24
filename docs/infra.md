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
4. 画面に表示されたリフレッシュトークンを、`google_oauth_credentials` テーブルへ手動で `INSERT` する(`accountLabel` には任意の識別名、例: `agency-a` を使う)。
5. `locations` テーブルに、動作確認したいビジネスの行を手動で `INSERT` する(`agencyId` は `agencies` テーブルに作成した代理店のID)。
6. `npm run fetch:one-day -- --location=<googleLocationId> --date=YYYY-MM-DD --account=<accountLabel>` を実行する。
7. `daily_metrics` テーブルに行が保存されていることを確認する。

## 未確定・将来の課題

- Cloud Scheduler 等による定期実行の設計は、このドキュメントの対象外です。別途相談の上、進め方を決めます。
