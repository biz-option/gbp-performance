import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { getCloudSqlConnectionName, getDatabaseUrl } from "../config/env.js";

// Prisma 7 以降、PrismaClient は接続情報を schema.prisma の datasource url からは
// 読み込まず、Driver Adapter を明示的に渡す必要がある。MySQL(Cloud SQL)には
// mariadb ドライバベースの公式アダプター(@prisma/adapter-mariadb)を使う
// (MariaDBプロトコルはMySQLと互換であり、Prismaの公式MySQL接続手段として案内されている)。
function createAdapter(): PrismaMariaDb {
  const databaseUrl = getDatabaseUrl();
  const cloudSqlConnectionName = getCloudSqlConnectionName();

  if (!cloudSqlConnectionName) {
    return new PrismaMariaDb(databaseUrl);
  }

  // Cloud RunはCloud SQLへの送信IPが固定されないため、承認済みネットワークによる
  // IP許可リストではなくCloud SQL Auth Proxy(Unixソケット)経由で接続する。
  // ユーザー名・パスワード・DB名はDATABASE_URLから流用し、host:portの代わりに
  // ソケットパスを使う。
  const parsedUrl = new URL(databaseUrl);
  return new PrismaMariaDb({
    socketPath: `/cloudsql/${cloudSqlConnectionName}`,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.replace(/^\//, ""),
  });
}

const adapter = createAdapter();

// アプリケーション全体で共有する PrismaClient のシングルトン。
// 接続プールを使い回すため、呼び出しごとに new しない。
export const prisma = new PrismaClient({ adapter });
