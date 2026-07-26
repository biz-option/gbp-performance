import type { PrismaClient } from "@prisma/client";
import { fetchAndStoreOneDay } from "./fetchAndStoreOneDay.js";
import { getSoleAccountLabel } from "./oauthClient.js";
import { getLastMetricDate } from "../db/dailyMetricsRepository.js";

/** Google側のデータ反映が安定するまで待つ日数。取得対象日 = 実行日からこの日数だけ遡った日。 */
export const FETCH_DELAY_DAYS = 5;

export interface RunDailyBatchParams {
  /** テストで「実行日」を固定するための注入。省略時は現在時刻を使う。 */
  now?: Date;
}

export interface RunDailyBatchSummary {
  succeeded: Array<{ locationId: number; date: string }>;
  failed: Array<{ locationId: number; date: string; error: unknown }>;
}

type Deps = Pick<PrismaClient, "location" | "googleOauthCredential" | "dailyMetric" | "agency">;

/**
 * 全locationを巡回し、「取得対象日の上限 = 実行日の FETCH_DELAY_DAYS 日前」まで
 * 未取得の日付をキャッチアップして取得する。個々のlocation・日付の取得処理そのものは
 * fetchAndStoreOneDay に委譲する(このファイルは巡回・欠損日キャッチアップ・
 * エラー時の継続処理のみを担当)。
 *
 * キャッチアップの考え方: daily_metrics に保存済みの最新日付の翌日から上限日まで、
 * 1日ずつ順に取得する。これにより、バッチが数日実行されなかった場合でも、
 * 次回実行時に欠損分をまとめて取得できる。
 *
 * このプロジェクトは単一のGoogleアカウント(代理店側がロケーションの権限をこの1アカウントに
 * 共有する運用)を前提としているため、accountLabel は代理店ごとではなく全location共通で
 * 1つだけ解決する(getSoleAccountLabel)。
 */
export async function runDailyBatch(
  prisma: Deps,
  params: RunDailyBatchParams = {},
): Promise<RunDailyBatchSummary> {
  const upperBound = addDays(toDateOnlyUTC(params.now ?? new Date()), -FETCH_DELAY_DAYS);
  const accountLabel = await getSoleAccountLabel(prisma);

  const locations = await prisma.location.findMany();

  const summary: RunDailyBatchSummary = { succeeded: [], failed: [] };

  for (const location of locations) {
    const lastMetricDate = await getLastMetricDate(prisma, location.id);
    let date = lastMetricDate ? addDays(lastMetricDate, 1) : upperBound;

    while (date <= upperBound) {
      const dateStr = formatDate(date);
      try {
        await fetchAndStoreOneDay(prisma, {
          googleLocationId: location.googleLocationId,
          date: dateStr,
          accountLabel,
        });
        summary.succeeded.push({ locationId: location.id, date: dateStr });
      } catch (error) {
        summary.failed.push({ locationId: location.id, date: dateStr, error });
      }
      date = addDays(date, 1);
    }
  }

  return summary;
}

function toDateOnlyUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
