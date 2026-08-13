// テスト対象: src/db/searchKeywordMetricsRepository.ts の
//   upsertSearchKeywordMetric / getLastSearchKeywordMonth
//
// 何を守るテストか:
//   同じ location/月/検索キーワードで複数回書き込んでも、行が重複せず1件に
//   まとまること(冪等性)。dailyMetricsRepository と同じ理由で必須の性質。
// モックについて:
//   実DBには接続しない。PrismaClient の searchKeywordMetric.upsert / aggregate を
//   vi.fn() で差し替え、正しい引数で呼ばれているかだけを検証する。

import { describe, expect, it, vi } from "vitest";
import {
  getLastSearchKeywordMonth,
  upsertSearchKeywordMetric,
} from "../src/db/searchKeywordMetricsRepository.js";

function createMockClient() {
  return {
    searchKeywordMetric: {
      upsert: vi.fn().mockResolvedValue({ id: 1n }),
    },
  };
}

describe("upsertSearchKeywordMetric", () => {
  it("locationId・metricMonth・searchKeyword の複合キーで upsert を呼ぶ(重複行を防ぐため)", async () => {
    const client = createMockClient();
    const metricMonth = new Date("2026-07-01");

    await upsertSearchKeywordMetric(client as never, {
      locationId: 42,
      metricMonth,
      searchKeyword: "赤羽 焼肉",
      value: 316,
      belowThreshold: null,
    });

    expect(client.searchKeywordMetric.upsert).toHaveBeenCalledWith({
      where: {
        search_keyword_metrics_locationId_metricMonth_searchKeyword_key: {
          locationId: 42,
          metricMonth,
          searchKeyword: "赤羽 焼肉",
        },
      },
      create: {
        locationId: 42,
        metricMonth,
        searchKeyword: "赤羽 焼肉",
        value: 316,
        belowThreshold: null,
      },
      update: {
        value: 316,
        belowThreshold: null,
      },
    });
  });

  // value と belowThreshold は排他(どちらか一方のみ非null)。閾値未満のキーワードを
  // 保存する際、value 側が誤って残らないことを確認する。
  it("value が null で belowThreshold のみ渡された場合、そのまま保存する", async () => {
    const client = createMockClient();

    await upsertSearchKeywordMetric(client as never, {
      locationId: 1,
      metricMonth: new Date("2026-07-01"),
      searchKeyword: "焼肉店",
      value: null,
      belowThreshold: 15,
    });

    const call = client.searchKeywordMetric.upsert.mock.calls[0]![0];
    expect(call.create).toMatchObject({ value: null, belowThreshold: 15 });
    expect(call.update).toEqual({ value: null, belowThreshold: 15 });
  });
});

describe("getLastSearchKeywordMonth", () => {
  it("locationId で絞り込んだ metricMonth の最大値を返す", async () => {
    const client = {
      searchKeywordMetric: {
        aggregate: vi.fn().mockResolvedValue({ _max: { metricMonth: new Date("2026-07-01") } }),
      },
    };

    const result = await getLastSearchKeywordMonth(client as never, 42);

    expect(client.searchKeywordMetric.aggregate).toHaveBeenCalledWith({
      where: { locationId: 42 },
      _max: { metricMonth: true },
    });
    expect(result).toEqual(new Date("2026-07-01"));
  });

  it("保存済みデータが1件もない場合は null を返す", async () => {
    const client = {
      searchKeywordMetric: {
        aggregate: vi.fn().mockResolvedValue({ _max: { metricMonth: null } }),
      },
    };

    const result = await getLastSearchKeywordMonth(client as never, 42);

    expect(result).toBeNull();
  });
});
