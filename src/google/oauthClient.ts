import { google, Common } from "googleapis";
import type { PrismaClient } from "@prisma/client";
import { getGoogleOAuthClientConfig } from "../config/env.js";

// googleapis が内部で使う google-auth-library と型を一致させるため、
// 独立した `google-auth-library` パッケージからではなく `googleapis` の
// 再エクスポート経由で OAuth2Client を扱う(バージョン不一致による型エラーを避けるため)。
export type OAuth2Client = Common.OAuth2Client;

// GBP Performance API の読み取りに必要な OAuth スコープ。
export const GOOGLE_BUSINESS_PROFILE_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
];

export function createOAuth2Client(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthClientConfig();
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
}

type CredentialClient = Pick<PrismaClient, "googleOauthCredential">;

/**
 * 指定したアカウントラベルに保存済みのリフレッシュトークンを使い、認可済みの
 * OAuth2Client を返す。アクセストークンの更新はライブラリが呼び出しごとに
 * 自動で行うため、ここではリフレッシュトークンをセットするだけでよい。
 * リフレッシュトークンの値自体はログ出力しない・戻り値として個別に返さない。
 */
export async function getAuthorizedClient(
  accountLabel: string,
  prisma: CredentialClient,
): Promise<OAuth2Client> {
  const credential = await prisma.googleOauthCredential.findUniqueOrThrow({
    where: { accountLabel },
  });

  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: credential.refreshToken });
  return client;
}

/**
 * このプロジェクトは単一のGoogleアカウント(代理店側が対象ロケーションの権限を
 * この1アカウントに共有する運用)のみを前提としている。google_oauth_credentials に
 * 登録されている唯一の accountLabel を返す(バッチが account を指定せずに
 * 全location を処理できるようにするため)。0件・複数件の場合は明確なエラーで止める。
 */
export async function getSoleAccountLabel(prisma: CredentialClient): Promise<string> {
  const credentials = await prisma.googleOauthCredential.findMany({
    select: { accountLabel: true },
  });

  if (credentials.length === 0) {
    throw new Error(
      "google_oauth_credentials に認証情報が登録されていません。" +
        "npm run oauth:bootstrap を実行し、表示されたリフレッシュトークンを登録してください。",
    );
  }
  if (credentials.length > 1) {
    throw new Error(
      "google_oauth_credentials に複数の認証情報が登録されています。" +
        "このプロジェクトは単一Googleアカウントのみを前提としています。",
    );
  }

  return credentials[0]!.accountLabel;
}
