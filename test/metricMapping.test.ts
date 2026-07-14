// テスト対象: src/google/metricMapping.ts の mapGoogleMetricToDbEnum
//
// 何を守るテストか:
//   Google Business Profile Performance API が返すメトリクス名の文字列と、
//   DBに保存する MetricType enum との対応関係。ここがズレると、
//   例えば「電話クリック数」のデータが誤って「予約数」として保存されるなど、
//   ユーザーに気づかれないままレポートの数字が壊れる。
// モックについて:
//   純粋関数なので外部依存はなく、モックは不要。

import { describe, expect, it } from "vitest";
import { MetricType } from "@prisma/client";
import { mapGoogleMetricToDbEnum } from "../src/google/metricMapping.js";

describe("mapGoogleMetricToDbEnum", () => {
  // 追跡対象の8メトリクスすべてについて、Google側の文字列がDBのenum値に
  // 正しく1対1で変換されることを1件ずつ確認する。
  const expectedMappings: Array<[string, MetricType]> = [
    ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", MetricType.BUSINESS_IMPRESSIONS_DESKTOP_MAPS],
    ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", MetricType.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH],
    ["BUSINESS_IMPRESSIONS_MOBILE_MAPS", MetricType.BUSINESS_IMPRESSIONS_MOBILE_MAPS],
    ["BUSINESS_IMPRESSIONS_MOBILE_SEARCH", MetricType.BUSINESS_IMPRESSIONS_MOBILE_SEARCH],
    ["CALL_CLICKS", MetricType.CALL_CLICKS],
    ["BUSINESS_BOOKINGS", MetricType.BUSINESS_BOOKINGS],
    ["BUSINESS_DIRECTION_REQUESTS", MetricType.BUSINESS_DIRECTION_REQUESTS],
    ["WEBSITE_CLICKS", MetricType.WEBSITE_CLICKS],
  ];

  it.each(expectedMappings)(
    "Google側のメトリクス名 %s を対応するDB enum値に変換する",
    (googleMetric, expected) => {
      expect(mapGoogleMetricToDbEnum(googleMetric)).toBe(expected);
    },
  );

  // Googleが将来新しいメトリクスを追加した場合(例: BUSINESS_FOOD_ORDERS)、
  // このパイプラインは未対応メトリクスとして黙ってスキップする設計になっている。
  // ここで例外を投げてしまうと、1件の未知メトリクスのために
  // その日の他の全メトリクスの取得まで失敗してしまうため、nullを返す仕様を保証する。
  it("追跡対象外・未知のメトリクス名に対しては null を返す(取得処理全体をクラッシュさせないため)", () => {
    expect(mapGoogleMetricToDbEnum("BUSINESS_FOOD_ORDERS")).toBeNull();
    expect(mapGoogleMetricToDbEnum("DAILY_METRIC_UNKNOWN")).toBeNull();
    expect(mapGoogleMetricToDbEnum("")).toBeNull();
  });
});
