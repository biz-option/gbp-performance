import type { PoolConfig } from "mariadb";

// この構成(VPCコネクタ/Direct VPC egress + Cloud NATによる送信IP固定を組んでいない
// Cloud Run Job)では送信IPが固定されないため、Cloud SQLの承認済みネットワークによる
// IP許可リストでは接続できない。cloudSqlConnectionNameが設定されている場合は、
// 代わりにCloud SQL Auth Proxyが自動でマウントするUnixソケット経由で接続する。
export function buildAdapterConfig(
  databaseUrl: string,
  cloudSqlConnectionName: string | undefined,
): string | PoolConfig {
  if (!cloudSqlConnectionName) {
    return databaseUrl;
  }

  // ユーザー名・パスワード・DB名・allowPublicKeyRetrievalはDATABASE_URLから流用し、
  // host:portの代わりにソケットパスを使う。
  const parsedUrl = new URL(databaseUrl);
  return {
    socketPath: `/cloudsql/${cloudSqlConnectionName}`,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.replace(/^\//, ""),
    allowPublicKeyRetrieval: parsedUrl.searchParams.get("allowPublicKeyRetrieval") === "true",
  };
}
