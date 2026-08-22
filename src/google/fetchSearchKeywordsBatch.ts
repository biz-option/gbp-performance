import type { PrismaClient } from "@prisma/client";
import { fetchAndStoreSearchKeywordsForMonth } from "./fetchAndStoreSearchKeywordsForMonth.js";
import { getSoleAccountLabel } from "./oauthClient.js";
import { getLastSearchKeywordMonth } from "../db/searchKeywordMetricsRepository.js";

/**
 * 「月が完全に終わってから何日待って安定したとみなすか」の遅延日数。
 * fetch-daily-batch の FETCH_DELAY_DAYS と同じ考え方(Googleのデータ反映が
 * 安定するまで待つ)を月次に適用したもの。
 *
 * この値により、月が変わってから丸 SEARCH_KEYWORDS_FETCH_DELAY_DAYS 日経過するまで、
 * 直前月は取得対象に入らない(computeUpperBoundMonth 参照)。そのため
 * Cloud Scheduler 等でこのバッチを月1回だけ実行する場合、月初1日や月末に実行しても
 * 直前月のデータはまだ取得できず(2か月遅れになる)、毎月6日以降に実行して初めて
 * 直前月のデータが取得対象に入る(docs/infra.md の「検索キーワードランキング月次バッチ」章参照)。
 */
export const SEARCH_KEYWORDS_FETCH_DELAY_DAYS = 5;

export interface RunSearchKeywordsBatchParams {
  /** テストで「実行日」を固定するための注入。省略時は現在時刻を使う。 */
  now?: Date;
}

export interface RunSearchKeywordsBatchSummary {
  succeeded: Array<{ locationId: number; month: string }>;
  failed: Array<{ locationId: number; month: string; error: unknown }>;
}

type Deps = Pick<
  PrismaClient,
  "location" | "googleOauthCredential" | "searchKeywordMetric"
>;

/**
 * 全locationを巡回し、「取得対象月の上限 = 実行日の SEARCH_KEYWORDS_FETCH_DELAY_DAYS 日前の
 * 時点で、既に終わっている直近の月」まで未取得の月をキャッチアップして取得する。
 * 個々の location・月の取得処理そのものは fetchAndStoreSearchKeywordsForMonth に委譲する
 * (このファイルは巡回・欠損月キャッチアップ・エラー時の継続処理のみを担当)。
 *
 * fetch-daily-batch と同様、あるlocationのある月の取得に失敗した場合、そのlocationの
 * 以降の月はこのバッチ内では取得しにいかない(次回実行時に同じ月から再開する)。
 * 失敗月をまたいで後続月だけ保存してしまうと、getLastSearchKeywordMonth が返す
 * MAX(metricMonth) が失敗月を追い越してしまい、失敗月が永久に再取得されなくなるため。
 */
export async function runSearchKeywordsBatch(
  prisma: Deps,
  params: RunSearchKeywordsBatchParams = {},
): Promise<RunSearchKeywordsBatchSummary> {
  const upperBound = computeUpperBoundMonth(params.now ?? new Date(), SEARCH_KEYWORDS_FETCH_DELAY_DAYS);
  const accountLabel = await getSoleAccountLabel(prisma);

  const locations = await prisma.location.findMany();

  const summary: RunSearchKeywordsBatchSummary = { succeeded: [], failed: [] };

  for (const location of locations) {
    const lastMonth = await getLastSearchKeywordMonth(prisma, location.id);
    let month = lastMonth ? addMonths(toMonthOnlyUTC(lastMonth), 1) : upperBound;

    while (month <= upperBound) {
      const monthStr = formatMonth(month);
      try {
        await fetchAndStoreSearchKeywordsForMonth(prisma, {
          googleLocationId: location.googleLocationId,
          month: monthStr,
          accountLabel,
        });
        summary.succeeded.push({ locationId: location.id, month: monthStr });
      } catch (error) {
        summary.failed.push({ locationId: location.id, month: monthStr, error });
        break;
      }
      month = addMonths(month, 1);
    }
  }

  return summary;
}

/** 実行日の delayDays 日前の時点で、既に完全に終わっている直近の月(月初日)を返す。 */
function computeUpperBoundMonth(now: Date, delayDays: number): Date {
  const cutoffDate = addDays(toDateOnlyUTC(now), -delayDays);
  return addMonths(toMonthOnlyUTC(cutoffDate), -1);
}

function toDateOnlyUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toMonthOnlyUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function formatMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}
