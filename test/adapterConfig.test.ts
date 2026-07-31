// テスト対象: src/db/adapterConfig.ts の buildAdapterConfig
//
// 何を守るテストか:
//   CLOUD_SQL_CONNECTION_NAME の有無で、Prismaの mariadb アダプターに渡す設定が
//   「DATABASE_URLの文字列そのまま(TCP接続)」と「Unixソケット用のPoolConfig」に
//   正しく分岐すること。特にソケット接続時、DATABASE_URLのユーザー名・パスワード・
//   DB名・allowPublicKeyRetrievalが欠落せず引き継がれることを守る
//   (欠落するとCloud SQL側の認証方式によっては接続できなくなる)。
// モックについて:
//   純粋関数なので外部依存はなく、モックは不要。

import { describe, expect, it } from "vitest";
import { buildAdapterConfig } from "../src/db/adapterConfig.js";

describe("buildAdapterConfig", () => {
  it("CLOUD_SQL_CONNECTION_NAME未設定時は、DATABASE_URLの文字列をそのまま返す(TCP接続)", () => {
    const url = "mariadb://gbp_app:pass123@35.194.113.60:3306/gbp_performance_db?allowPublicKeyRetrieval=true";
    expect(buildAdapterConfig(url, undefined)).toBe(url);
  });

  it("CLOUD_SQL_CONNECTION_NAME設定時は、Unixソケット用のPoolConfigに変換する", () => {
    const url = "mariadb://gbp_app:pass123@35.194.113.60:3306/gbp_performance_db?allowPublicKeyRetrieval=true";
    const config = buildAdapterConfig(url, "oaky-gmb:asia-northeast1:gbp-performance-sql-instance");

    expect(config).toEqual({
      socketPath: "/cloudsql/oaky-gmb:asia-northeast1:gbp-performance-sql-instance",
      user: "gbp_app",
      password: "pass123",
      database: "gbp_performance_db",
      allowPublicKeyRetrieval: true,
    });
  });

  it("ソケット接続時、URLエンコードされたパスワードをデコードして引き継ぐ", () => {
    const url = "mariadb://gbp_app:p%40ss%3A123@35.194.113.60:3306/gbp_performance_db";
    const config = buildAdapterConfig(url, "oaky-gmb:asia-northeast1:gbp-performance-sql-instance");

    expect(config).toMatchObject({
      user: "gbp_app",
      password: "p@ss:123",
      allowPublicKeyRetrieval: false,
    });
  });
});
