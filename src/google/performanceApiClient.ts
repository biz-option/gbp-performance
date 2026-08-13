import { google } from "googleapis";
import type { OAuth2Client } from "./oauthClient.js";

export interface DateComponents {
  year: number;
  month: number;
  day: number;
}

export interface MonthComponents {
  year: number;
  month: number;
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

export interface RawSearchKeywordCount {
  searchKeyword: string;
  /** APIが実数を返した場合の値。閾値のみ返した場合は null。 */
  value: number | null;
  /**
   * APIがプライバシー保護のため実数の代わりに返す閾値(実際の値はこの値未満)。
   * 実数が返された場合は null。
   */
  belowThreshold: number | null;
}

export interface FetchSearchKeywordsParams {
  googleLocationId: string;
  /** 集計対象の月(単一月)。 */
  month: MonthComponents;
}

const SEARCH_KEYWORDS_PAGE_SIZE = 100;

/**
 * 指定した1ロケーション・1か月分の検索キーワード(そのビジネスプロフィールが表示された
 * 検索語句)を、インプレッション(ユニークユーザー数)とともに取得する。
 * レスポンスはページングされるため、nextPageToken が無くなるまで全ページ取得する。
 */
export async function fetchSearchKeywords(
  authClient: OAuth2Client,
  params: FetchSearchKeywordsParams,
): Promise<RawSearchKeywordCount[]> {
  const api = google.businessprofileperformance({ version: "v1", auth: authClient });

  const results: RawSearchKeywordCount[] = [];
  let pageToken: string | undefined;

  do {
    const response = await api.locations.searchkeywords.impressions.monthly.list({
      parent: `locations/${params.googleLocationId}`,
      "monthlyRange.startMonth.year": params.month.year,
      "monthlyRange.startMonth.month": params.month.month,
      "monthlyRange.endMonth.year": params.month.year,
      "monthlyRange.endMonth.month": params.month.month,
      pageSize: SEARCH_KEYWORDS_PAGE_SIZE,
      pageToken,
    });

    for (const entry of response.data.searchKeywordsCounts ?? []) {
      const insights = entry.insightsValue;
      results.push({
        searchKeyword: entry.searchKeyword ?? "",
        value: insights?.value != null ? Number(insights.value) : null,
        belowThreshold: insights?.threshold != null ? Number(insights.threshold) : null,
      });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return results;
}
