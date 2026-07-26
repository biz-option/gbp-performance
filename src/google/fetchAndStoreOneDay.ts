import type { PrismaClient } from "@prisma/client";
import { getAuthorizedClient } from "./oauthClient.js";
import { fetchDailyMetrics, type DateComponents } from "./performanceApiClient.js";
import { ALL_TRACKED_GOOGLE_METRICS, mapGoogleMetricToDbEnum } from "./metricMapping.js";
import { upsertDailyMetric } from "../db/dailyMetricsRepository.js";
import { advanceConfirmedThroughDate } from "../db/agencyConfirmationRepository.js";

export interface FetchAndStoreOneDayParams {
  googleLocationId: string;
  /** YYYY-MM-DD 形式の日付。 */
  date: string;
  accountLabel: string;
}

export interface FetchAndStoreOneDaySummary {
  locationId: number;
  metricDate: string;
  stored: Array<{ metricType: string; value: number }>;
  /** DB側で追跡していないGoogle側メトリクス名(スキップされたもの)。 */
  skipped: string[];
}

type Deps = Pick<PrismaClient, "location" | "googleOauthCredential" | "dailyMetric" | "agency">;

/**
 * 指定した1ロケーション・1日分のパフォーマンスデータを Google API から取得し、
 * daily_metrics に保存する単純な1回取得(いつ・どの日付を取得するかの判断はこの関数の
 * 呼び出し側の責務)。保存後、この日付に非0のメトリクスがあれば、所属する代理店の
 * confirmedThroughDate を前進させる(詳細は agencyConfirmationRepository 参照)。
 */
export async function fetchAndStoreOneDay(
  prisma: Deps,
  params: FetchAndStoreOneDayParams,
): Promise<FetchAndStoreOneDaySummary> {
  const location = await prisma.location.findFirst({
    where: { googleLocationId: params.googleLocationId },
  });

  if (!location) {
    throw new Error(
      `googleLocationId=${params.googleLocationId} の location がDBに見つかりません。` +
        "先に locations テーブルへ登録してください(このスクリプトは location を作成しません)。",
    );
  }

  const authClient = await getAuthorizedClient(params.accountLabel, prisma);
  const dateComponents = parseDateComponents(params.date);

  const rawSeries = await fetchDailyMetrics(authClient, {
    googleLocationId: params.googleLocationId,
    date: dateComponents,
    metrics: [...ALL_TRACKED_GOOGLE_METRICS],
  });

  const metricDate = new Date(`${params.date}T00:00:00.000Z`);
  const stored: Array<{ metricType: string; value: number }> = [];
  const skipped: string[] = [];

  for (const entry of rawSeries) {
    const metricType = mapGoogleMetricToDbEnum(entry.metricType);
    if (!metricType) {
      skipped.push(entry.metricType);
      continue;
    }

    await upsertDailyMetric(prisma, {
      locationId: location.id,
      metricDate,
      metricType,
      value: entry.value,
    });
    stored.push({ metricType, value: entry.value });
  }

  await advanceConfirmedThroughDate(prisma, {
    agencyId: location.agencyId,
    fetchedDate: metricDate,
  });

  return { locationId: location.id, metricDate: params.date, stored, skipped };
}

function parseDateComponents(date: string): DateComponents {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`date は YYYY-MM-DD 形式で指定してください(渡された値: "${date}")`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
