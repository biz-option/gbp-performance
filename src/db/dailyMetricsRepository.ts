import type { DailyMetric, MetricType, PrismaClient } from "@prisma/client";

export interface UpsertDailyMetricInput {
  locationId: number;
  metricDate: Date;
  metricType: MetricType;
  value: number;
}

// テストで PrismaClient 全体をモックしなくて済むよう、必要な部分だけを型で要求する。
type DailyMetricClient = Pick<PrismaClient, "dailyMetric">;

/**
 * 指定した location/日付/メトリクス種別の値を保存する。
 * 同じ組み合わせで再実行しても行が重複せず、既存行が更新されるだけ(冪等)。
 * バッチ(fetch-daily-batch)は各(location, 日付)を一度しか取得しない設計だが、
 * 手動でのバックフィル・再取得(fetch-one-day)で同じ日付を再実行しても
 * 行が重複しないようにするために必須の性質。
 */
export async function upsertDailyMetric(
  client: DailyMetricClient,
  input: UpsertDailyMetricInput,
): Promise<DailyMetric> {
  return client.dailyMetric.upsert({
    where: {
      daily_metrics_locationId_metricDate_metricType_key: {
        locationId: input.locationId,
        metricDate: input.metricDate,
        metricType: input.metricType,
      },
    },
    create: {
      locationId: input.locationId,
      metricDate: input.metricDate,
      metricType: input.metricType,
      value: input.value,
    },
    update: {
      value: input.value,
    },
  });
}

type LastMetricDateClient = Pick<PrismaClient, "dailyMetric">;

/**
 * 指定した location について、これまでに daily_metrics へ保存された最新の metricDate を返す。
 * バッチ処理が「どの日付から取得を再開すべきか」を判断するために使う
 * (1件も保存されていない場合は null を返す)。
 */
export async function getLastMetricDate(
  client: LastMetricDateClient,
  locationId: number,
): Promise<Date | null> {
  const result = await client.dailyMetric.aggregate({
    where: { locationId },
    _max: { metricDate: true },
  });
  return result._max.metricDate ?? null;
}
