import type { PrismaClient, SearchKeywordMetric } from "@prisma/client";

export interface UpsertSearchKeywordMetricInput {
  locationId: number;
  metricMonth: Date;
  searchKeyword: string;
  value: number | null;
  belowThreshold: number | null;
}

// テストで PrismaClient 全体をモックしなくて済むよう、必要な部分だけを型で要求する。
type SearchKeywordMetricClient = Pick<PrismaClient, "searchKeywordMetric">;

/**
 * 指定した location/月/検索キーワードの値を保存する。
 * 同じ組み合わせで再実行しても行が重複せず、既存行が更新されるだけ(冪等)。
 */
export async function upsertSearchKeywordMetric(
  client: SearchKeywordMetricClient,
  input: UpsertSearchKeywordMetricInput,
): Promise<SearchKeywordMetric> {
  return client.searchKeywordMetric.upsert({
    where: {
      search_keyword_metrics_locationId_metricMonth_searchKeyword_key: {
        locationId: input.locationId,
        metricMonth: input.metricMonth,
        searchKeyword: input.searchKeyword,
      },
    },
    create: {
      locationId: input.locationId,
      metricMonth: input.metricMonth,
      searchKeyword: input.searchKeyword,
      value: input.value,
      belowThreshold: input.belowThreshold,
    },
    update: {
      value: input.value,
      belowThreshold: input.belowThreshold,
    },
  });
}

type LastSearchKeywordMonthClient = Pick<PrismaClient, "searchKeywordMetric">;

/**
 * 指定した location について、これまでに search_keyword_metrics へ保存された
 * 最新の metricMonth を返す。バッチ処理が「どの月から取得を再開すべきか」を
 * 判断するために使う(1件も保存されていない場合は null を返す)。
 */
export async function getLastSearchKeywordMonth(
  client: LastSearchKeywordMonthClient,
  locationId: number,
): Promise<Date | null> {
  const result = await client.searchKeywordMetric.aggregate({
    where: { locationId },
    _max: { metricMonth: true },
  });
  return result._max.metricMonth ?? null;
}
