import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { getCloudSqlConnectionName, getDatabaseUrl } from "../config/env.js";
import { buildAdapterConfig } from "./adapterConfig.js";

// Prisma 7 以降、PrismaClient は接続情報を schema.prisma の datasource url からは
// 読み込まず、Driver Adapter を明示的に渡す必要がある。MySQL(Cloud SQL)には
// mariadb ドライバベースの公式アダプター(@prisma/adapter-mariadb)を使う
// (MariaDBプロトコルはMySQLと互換であり、Prismaの公式MySQL接続手段として案内されている)。
const adapter = new PrismaMariaDb(buildAdapterConfig(getDatabaseUrl(), getCloudSqlConnectionName()));

// アプリケーション全体で共有する PrismaClient のシングルトン。
// 接続プールを使い回すため、呼び出しごとに new しない。
export const prisma = new PrismaClient({ adapter });
