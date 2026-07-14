// テスト対象: src/db/dailyMetricsRepository.ts の upsertDailyMetric
//
// 何を守るテストか:
//   同じ location/日付/メトリクス種別で複数回書き込んでも、行が重複せず1件に
//   まとまること(冪等性)。これは将来のバッチジョブが「0件だったら再試行」を
//   複数日にわたって行う設計のため必須の性質で、ここが壊れると同じ日のデータが
//   何行にも重複してレポートの数字が水増しされる。
// モックについて:
//   実DBには接続しない。PrismaClient の dailyMetric.upsert を vi.fn() で
//   差し替え、正しい引数で呼ばれているかだけを検証する。

import { describe, expect, it, vi } from "vitest";
import { MetricType } from "@prisma/client";
import { upsertDailyMetric } from "../src/db/dailyMetricsRepository.js";

function createMockClient() {
  return {
    dailyMetric: {
      upsert: vi.fn().mockResolvedValue({ id: 1n }),
    },
  };
}

describe("upsertDailyMetric", () => {
  it("locationId・metricDate・metricType の複合キーで upsert を呼ぶ(重複行を防ぐため)", async () => {
    const client = createMockClient();
    const metricDate = new Date("2026-07-10");

    await upsertDailyMetric(client as never, {
      locationId: 42,
      metricDate,
      metricType: MetricType.CALL_CLICKS,
      value: 7,
    });

    expect(client.dailyMetric.upsert).toHaveBeenCalledWith({
      where: {
        daily_metrics_locationId_metricDate_metricType_key: {
          locationId: 42,
          metricDate,
          metricType: MetricType.CALL_CLICKS,
        },
      },
      create: {
        locationId: 42,
        metricDate,
        metricType: MetricType.CALL_CLICKS,
        value: 7,
      },
      update: {
        value: 7,
      },
    });
  });

  // create と update の両方に同じ value がセットされていることを確認する。
  // どちらか一方だけ更新し忘れるコピペミスがあると、新規作成時と再取得時とで
  // 保存される値が食い違うバグになる。
  it("create と update の両方に同じ value が渡る", async () => {
    const client = createMockClient();

    await upsertDailyMetric(client as never, {
      locationId: 1,
      metricDate: new Date("2026-07-10"),
      metricType: MetricType.WEBSITE_CLICKS,
      value: 99,
    });

    const call = client.dailyMetric.upsert.mock.calls[0]![0];
    expect(call.create.value).toBe(99);
    expect(call.update.value).toBe(99);
  });
});
