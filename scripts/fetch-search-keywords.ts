#!/usr/bin/env -S node --import tsx
// ローカル動作確認用CLI: 指定した1ロケーション・1か月分の検索キーワードランキングを
// Google API から取得し、search_keyword_metrics テーブルへ保存する。
//
// 実行例:
//   npm run fetch:search-keywords -- --location=12345678901234567890 --month=2026-07 --account=agency-a
//
// このスクリプトは薄いラッパーで、実処理は src/google/fetchAndStoreSearchKeywordsForMonth.ts が行う
// (ロジック本体をCLIから切り離すことで、プロセスを起動せずにテストできるようにしている)。

import "dotenv/config";
import { prisma } from "../src/db/prismaClient.js";
import { fetchAndStoreSearchKeywordsForMonth } from "../src/google/fetchAndStoreSearchKeywordsForMonth.js";

function parseArgs(argv: string[]): { location: string; month: string; account: string } {
  const options: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match?.[1] && match[2] !== undefined) {
      options[match[1]] = match[2];
    }
  }

  const { location, month, account } = options;
  if (!location || !month || !account) {
    throw new Error(
      "使い方: fetch-search-keywords --location=<googleLocationId> --month=<YYYY-MM> --account=<accountLabel>",
    );
  }
  return { location, month, account };
}

async function main() {
  const { location, month, account } = parseArgs(process.argv.slice(2));

  const summary = await fetchAndStoreSearchKeywordsForMonth(prisma, {
    googleLocationId: location,
    month,
    accountLabel: account,
  });

  console.log(`location #${summary.locationId} / ${summary.metricMonth} の取得結果:`);
  for (const item of summary.stored) {
    const displayValue = item.value != null ? item.value : `< ${item.belowThreshold}`;
    console.log(`  ${item.searchKeyword}: ${displayValue}`);
  }
  console.log(`  合計 ${summary.stored.length} キーワード`);
}

main()
  .catch((error: unknown) => {
    console.error("fetch-search-keywords 実行中にエラーが発生しました:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
