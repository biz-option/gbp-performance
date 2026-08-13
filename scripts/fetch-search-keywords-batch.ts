#!/usr/bin/env -S node --import tsx
// Cloud Scheduler 等から定期実行される想定のバッチ本体を呼び出す薄いCLIラッパー。
// 実処理(全locationの巡回・欠損月キャッチアップ)は src/google/fetchSearchKeywordsBatch.ts が行う
// (ロジック本体をCLIから切り離すことで、プロセスを起動せずにテストできるようにしている)。
//
// 実行例:
//   npm run fetch:search-keywords-batch

import "dotenv/config";
import { prisma } from "../src/db/prismaClient.js";
import { runSearchKeywordsBatch } from "../src/google/fetchSearchKeywordsBatch.js";

async function main() {
  const summary = await runSearchKeywordsBatch(prisma);

  for (const item of summary.succeeded) {
    console.log(`location #${item.locationId} / ${item.month}: 取得成功`);
  }
  for (const item of summary.failed) {
    console.error(`location #${item.locationId} / ${item.month}: 取得失敗`, item.error);
  }

  console.log(`完了: 成功 ${summary.succeeded.length} 件 / 失敗 ${summary.failed.length} 件`);

  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("fetch-search-keywords-batch 実行中に予期しないエラーが発生しました:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
