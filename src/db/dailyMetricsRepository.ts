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
 * これは、将来のバッチジョブが同じ日を複数回(0件フラグ→再試行)取得しにいく設計と
 * 整合させるために必須の性質。
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
