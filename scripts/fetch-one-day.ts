#!/usr/bin/env -S node --import tsx
// ローカル動作確認用CLI: 指定した1ロケーション・1日分のパフォーマンスデータを
// Google API から取得し、daily_metrics テーブルへ保存する。
//
// 実行例:
//   npm run fetch:one-day -- --location=12345678901234567890 --date=2026-07-01 --account=agency-a
//
// このスクリプトは薄いラッパーで、実処理は src/google/fetchAndStoreOneDay.ts が行う
// (ロジック本体をCLIから切り離すことで、プロセスを起動せずにテストできるようにしている)。

import { prisma } from "../src/db/prismaClient.js";
import { fetchAndStoreOneDay } from "../src/google/fetchAndStoreOneDay.js";

function parseArgs(argv: string[]): { location: string; date: string; account: string } {
  const options: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match?.[1] && match[2] !== undefined) {
      options[match[1]] = match[2];
    }
  }

  const { location, date, account } = options;
  if (!location || !date || !account) {
    throw new Error(
      "使い方: fetch-one-day --location=<googleLocationId> --date=<YYYY-MM-DD> --account=<accountLabel>",
    );
  }
  return { location, date, account };
}

async function main() {
  const { location, date, account } = parseArgs(process.argv.slice(2));

  const summary = await fetchAndStoreOneDay(prisma, {
    googleLocationId: location,
    date,
    accountLabel: account,
  });

  console.log(`location #${summary.locationId} / ${summary.metricDate} の取得結果:`);
  for (const item of summary.stored) {
    console.log(`  ${item.metricType}: ${item.value}`);
  }
  if (summary.skipped.length > 0) {
    console.log(`  (未追跡のためスキップ: ${summary.skipped.join(", ")})`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("fetch-one-day 実行中にエラーが発生しました:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
