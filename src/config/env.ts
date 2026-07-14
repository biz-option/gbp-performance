// このアプリケーションで `process.env` を直接読むのはこのモジュールだけにする。
// 本番環境ではこれらの環境変数は Secret Manager の値がデプロイ時に注入される想定
// (アプリコード自身は Secret Manager API を呼ばない)。ローカル開発では .env を使う。

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env.example を参考に .env を用意してください。`,
    );
  }
  return value;
}

export function getDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthClientConfig(): GoogleOAuthClientConfig {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}
