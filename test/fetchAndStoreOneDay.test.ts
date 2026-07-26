// テスト対象: src/google/fetchAndStoreOneDay.ts の fetchAndStoreOneDay
//
// 何を守るテストか:
//   「location取得 → Google認可 → API取得 → メトリクス変換 → DB保存」という
//   一連のグルーロジックが、実DB・実Google認証なしで正しくつながっていること。
//   個々の部品(metricMapping, dailyMetricsRepository)は別ファイルで単体テスト済みなので、
//   ここでは「それらを正しい順序・正しい引数で呼び出しているか」だけを見る。
// モックについて:
//   - Prisma(location検索・upsert)はオブジェクトごと vi.fn() で差し替え、実DBに接続しない。
//   - Google側のOAuth認可・API呼び出しは vi.mock で丸ごと差し替え、実Googleアカウントを使わない。

import { describe, expect, it, vi, beforeEach } from "vitest";
import { MetricType } from "@prisma/client";

vi.mock("../src/google/oauthClient.js", () => ({
  getAuthorizedClient: vi.fn().mockResolvedValue({ __fakeAuthClient: true }),
}));

vi.mock("../src/google/performanceApiClient.js", () => ({
  fetchDailyMetrics: vi.fn(),
}));

const { getAuthorizedClient } = await import("../src/google/oauthClient.js");
const { fetchDailyMetrics } = await import("../src/google/performanceApiClient.js");
const { fetchAndStoreOneDay } = await import("../src/google/fetchAndStoreOneDay.js");

function createMockPrisma() {
  return {
    location: {
      findFirst: vi.fn().mockResolvedValue({ id: 100, googleLocationId: "loc-1", agencyId: 1 }),
    },
    googleOauthCredential: {
      findUniqueOrThrow: vi.fn(),
    },
    dailyMetric: {
      upsert: vi.fn().mockResolvedValue({ id: 1n }),
      // 代理店の確定日ウォーターマーク更新(advanceConfirmedThroughDate)が内部で呼ぶ。
      // デフォルトでは「非0のメトリクスなし」を返し、ウォーターマーク更新をスキップさせる。
      findFirst: vi.fn().mockResolvedValue(null),
    },
    agency: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchAndStoreOneDay", () => {
  it("取得できたメトリクスを location に紐づけて保存し、サマリを返す", async () => {
    const prisma = createMockPrisma();
    prisma.location.findFirst.mockResolvedValue({
      id: 100,
      googleLocationId: "loc-1",
      agencyId: 1,
    });
    vi.mocked(fetchDailyMetrics).mockResolvedValue([
      { metricType: "CALL_CLICKS", value: 3 },
      { metricType: "WEBSITE_CLICKS", value: 5 },
    ]);

    const result = await fetchAndStoreOneDay(prisma as never, {
      googleLocationId: "loc-1",
      date: "2026-07-01",
      accountLabel: "agency-a",
    });

    expect(getAuthorizedClient).toHaveBeenCalledWith("agency-a", prisma);
    expect(prisma.dailyMetric.upsert).toHaveBeenCalledTimes(2);
    expect(result.stored).toEqual([
      { metricType: MetricType.CALL_CLICKS, value: 3 },
      { metricType: MetricType.WEBSITE_CLICKS, value: 5 },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.locationId).toBe(100);
  });

  // Googleが新しいメトリクスを追加していた場合、そのメトリクスだけをスキップし、
  // 他の追跡対象メトリクスの保存処理は止めない、という要件を検証する。
  it("未追跡のメトリクスが混ざっていてもクラッシュせず、そのメトリクスだけをスキップする", async () => {
    const prisma = createMockPrisma();
    vi.mocked(fetchDailyMetrics).mockResolvedValue([
      { metricType: "CALL_CLICKS", value: 1 },
      { metricType: "BUSINESS_FOOD_ORDERS", value: 9 }, // 未追跡メトリクス
    ]);

    const result = await fetchAndStoreOneDay(prisma as never, {
      googleLocationId: "loc-1",
      date: "2026-07-01",
      accountLabel: "agency-a",
    });

    expect(prisma.dailyMetric.upsert).toHaveBeenCalledTimes(1);
    expect(result.stored).toEqual([{ metricType: MetricType.CALL_CLICKS, value: 1 }]);
    expect(result.skipped).toEqual(["BUSINESS_FOOD_ORDERS"]);
  });

  // locations テーブルに未登録の googleLocationId を指定した場合、
  // このスクリプトが勝手に location を作らず、明確なエラーで止まることを確認する。
  it("DBに存在しない location を指定するとエラーになる", async () => {
    const prisma = createMockPrisma();
    prisma.location.findFirst.mockResolvedValue(null);

    await expect(
      fetchAndStoreOneDay(prisma as never, {
        googleLocationId: "unknown-loc",
        date: "2026-07-01",
        accountLabel: "agency-a",
      }),
    ).rejects.toThrow(/見つかりません/);

    expect(fetchDailyMetrics).not.toHaveBeenCalled();
  });

  // date のフォーマットが崩れている場合、Google APIを呼ぶ前に早期にエラーとする。
  it("date が YYYY-MM-DD 形式でない場合はエラーになる", async () => {
    const prisma = createMockPrisma();

    await expect(
      fetchAndStoreOneDay(prisma as never, {
        googleLocationId: "loc-1",
        date: "2026/07/01",
        accountLabel: "agency-a",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});
