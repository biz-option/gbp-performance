import { MetricType } from "@prisma/client";

// Google Business Profile Performance API がレスポンスで返すメトリクス名(例: "CALL_CLICKS")を
// DBの MetricType enum に変換する。
//
// 現状 Google 側のメトリクス名は DB の enum 値と文字列として一致しているが、
// 「Google側の命名にDBが引きずられている」実装にしないため、変換テーブルを明示的に持つ。
// これにより、将来 Google が新しいメトリクスを追加しても(例: BUSINESS_FOOD_ORDERS)、
// 未対応のメトリクスは自動的に無視され、パイプライン全体がクラッシュすることはない。
const GOOGLE_METRIC_TO_DB_ENUM: Readonly<Record<string, MetricType>> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: MetricType.BUSINESS_IMPRESSIONS_DESKTOP_MAPS,
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: MetricType.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH,
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: MetricType.BUSINESS_IMPRESSIONS_MOBILE_MAPS,
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: MetricType.BUSINESS_IMPRESSIONS_MOBILE_SEARCH,
  CALL_CLICKS: MetricType.CALL_CLICKS,
  BUSINESS_BOOKINGS: MetricType.BUSINESS_BOOKINGS,
  BUSINESS_DIRECTION_REQUESTS: MetricType.BUSINESS_DIRECTION_REQUESTS,
  WEBSITE_CLICKS: MetricType.WEBSITE_CLICKS,
};

/**
 * Google API のメトリクス名を DB の MetricType に変換する。
 * 追跡対象外のメトリクス(未知の名称、または DAILY_METRIC_UNKNOWN 等)は null を返す。
 */
export function mapGoogleMetricToDbEnum(googleMetric: string): MetricType | null {
  return GOOGLE_METRIC_TO_DB_ENUM[googleMetric] ?? null;
}

// API 呼び出し時に dailyMetrics パラメータとして渡す、追跡対象のGoogle側メトリクス名一覧。
export const ALL_TRACKED_GOOGLE_METRICS: readonly string[] = Object.keys(
  GOOGLE_METRIC_TO_DB_ENUM,
);
