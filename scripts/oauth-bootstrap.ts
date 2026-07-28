#!/usr/bin/env -S node --import tsx
// 一度きりの手動ツール: Google アカウントの OAuth リフレッシュトークンを取得する。
//
// このスクリプトはリフレッシュトークンを画面に表示するだけで、どこにも保存しない。
// Claude(このコードを書いたAIエージェント)は実際のリフレッシュトークンの値を
// 見ることも扱うこともない設計になっている。取得後は、表示された値を
// 利用者自身の手で google_oauth_credentials テーブルに登録すること。
//
// 実行方法: npm run oauth:bootstrap

import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { createOAuth2Client, GOOGLE_BUSINESS_PROFILE_SCOPES } from "../src/google/oauthClient.js";

async function main() {
  const client = createOAuth2Client();

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_BUSINESS_PROFILE_SCOPES,
  });

  console.log("以下のURLをブラウザで開き、Googleアカウントで認可してください:");
  console.log(authUrl);
  console.log("");
  console.log(
    "認可後、リダイレクト先URLの `code` クエリパラメータの値をコピーして貼り付けてください。",
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("code: ")).trim();
  rl.close();

  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "リフレッシュトークンが返却されませんでした。" +
        "既にこのアカウントで同意済みの場合、Googleの同意画面で再度同意を求める" +
        "(prompt=consent)必要があります。一度アプリの連携を解除してから再実行してください。",
    );
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("=== リフレッシュトークン(この画面にのみ表示されます。安全に保管してください) ===");
  console.log(tokens.refresh_token);
  console.log("===============================================================");
  console.log("");
  console.log(
    "この値を google_oauth_credentials テーブルへ手動で登録してください。" +
      "このスクリプト自体はファイルへの保存や外部送信を一切行いません。",
  );
}

main().catch((error: unknown) => {
  console.error("OAuthブートストラップ中にエラーが発生しました:", error);
  process.exitCode = 1;
});
