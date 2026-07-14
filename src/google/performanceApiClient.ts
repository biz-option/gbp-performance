import { google } from "googleapis";
import type { OAuth2Client } from "./oauthClient.js";

export interface DateComponents {
  year: number;
  month: number;
  day: number;
}

export interface RawDailyMetricSeries {
  /** Google側のメトリクス名(例: "CALL_CLICKS")。マッピングは呼び出し側で行う。 */
  metricType: string;
  value: number;
}

export interface FetchDailyMetricsParams {
  googleLocationId: string;
  date: DateComponents;
  metrics: string[];
}

/**
 * 指定した1日分の日次パフォーマンスメトリクスを取得する。
 *
 * 注意: Google API は値が0の日は datedValues 中に value フィールド自体を省略する
 * (「取得できない」のか「本当に0件」なのかをAPIレスポンスだけでは区別できない設計)。
 * このスライスでは省略時を単純に 0 として扱い、3日後取得ルールやフラグ付け・再試行と
 * いった0件の真偽を見極めるロジックは適用しない(将来のバッチジョブ側で実装する)。
 */
export async function fetchDailyMetrics(
  authClient: OAuth2Client,
  params: FetchDailyMetricsParams,
): Promise<RawDailyMetricSeries[]> {
  const api = google.businessprofileperformance({ version: "v1", auth: authClient });

  const response = await api.locations.fetchMultiDailyMetricsTimeSeries({
    location: `locations/${params.googleLocationId}`,
    dailyMetrics: params.metrics,
    "dailyRange.startDate.year": params.date.year,
    "dailyRange.startDate.month": params.date.month,
    "dailyRange.startDate.day": params.date.day,
    "dailyRange.endDate.year": params.date.year,
    "dailyRange.endDate.month": params.date.month,
    "dailyRange.endDate.day": params.date.day,
  });

  const series = response.data.multiDailyMetricTimeSeries ?? [];

  return series.flatMap((entry) =>
    (entry.dailyMetricTimeSeries ?? []).map((metricSeries) => {
      const datapoint = metricSeries.timeSeries?.datedValues?.[0];
      return {
        metricType: metricSeries.dailyMetric ?? "",
        value: datapoint?.value != null ? Number(datapoint.value) : 0,
      };
    }),
  );
}
