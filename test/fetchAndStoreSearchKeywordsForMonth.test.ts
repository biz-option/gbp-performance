// テスト対象: src/google/fetchAndStoreSearchKeywordsForMonth.ts の
//   fetchAndStoreSearchKeywordsForMonth
//
// 何を守るテストか:
//   「location取得 → Google認可 → API取得 → DB保存」という一連のグルーロジックが、
//   実DB・実Google認証なしで正しくつながっていること。個々の部品
//   (searchKeywordMetricsRepository)は別ファイルで単体テスト済みなので、
//   ここでは「それらを正しい順序・正しい引数で呼び出しているか」だけを見る。
// モックについて:
//   - Prisma(location検索)はオブジェクトごと vi.fn() で差し替え、実DBに接続しない。
//   - Google側のOAuth認可・API呼び出しは vi.mock で丸ごと差し替え、実Googleアカウントを使わない。

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/google/oauthClient.js", () => ({
  getAuthorizedClient: vi.fn().mockResolvedValue({ __fakeAuthClient: true }),
}));

vi.mock("../src/google/performanceApiClient.js", () => ({
  fetchSearchKeywords: vi.fn(),
}));

const { getAuthorizedClient } = await import("../src/google/oauthClient.js");
const { fetchSearchKeywords } = await import("../src/google/performanceApiClient.js");
const { fetchAndStoreSearchKeywordsForMonth } = await import(
  "../src/google/fetchAndStoreSearchKeywordsForMonth.js"
);

function createMockPrisma() {
  return {
    location: {
      findFirst: vi.fn().mockResolvedValue({ id: 100, googleLocationId: "loc-1", agencyId: 1 }),
    },
    googleOauthCredential: {
      findUniqueOrThrow: vi.fn(),
    },
    searchKeywordMetric: {
      upsert: vi.fn().mockResolvedValue({ id: 1n }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchAndStoreSearchKeywordsForMonth", () => {
  it("取得できたキーワードを location に紐づけて保存し、サマリを返す", async () => {
    const prisma = createMockPrisma();
    vi.mocked(fetchSearchKeywords).mockResolvedValue([
      { searchKeyword: "赤羽 焼肉", value: 316, belowThreshold: null },
      { searchKeyword: "焼肉店", value: null, belowThreshold: 15 },
    ]);

    const result = await fetchAndStoreSearchKeywordsForMonth(prisma as never, {
      googleLocationId: "loc-1",
      month: "2026-07",
      accountLabel: "agency-a",
    });

    expect(getAuthorizedClient).toHaveBeenCalledWith("agency-a", prisma);
    expect(fetchSearchKeywords).toHaveBeenCalledWith(
      { __fakeAuthClient: true },
      { googleLocationId: "loc-1", month: { year: 2026, month: 7 } },
    );
    expect(prisma.searchKeywordMetric.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.searchKeywordMetric.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          locationId: 100,
          metricMonth: new Date("2026-07-01T00:00:00.000Z"),
          searchKeyword: "赤羽 焼肉",
          value: 316,
          belowThreshold: null,
        }),
      }),
    );
    expect(result.locationId).toBe(100);
    expect(result.metricMonth).toBe("2026-07");
    expect(result.stored).toEqual([
      { searchKeyword: "赤羽 焼肉", value: 316, belowThreshold: null },
      { searchKeyword: "焼肉店", value: null, belowThreshold: 15 },
    ]);
  });

  // locations テーブルに未登録の googleLocationId を指定した場合、
  // このスクリプトが勝手に location を作らず、明確なエラーで止まることを確認する。
  it("DBに存在しない location を指定するとエラーになる", async () => {
    const prisma = createMockPrisma();
    prisma.location.findFirst.mockResolvedValue(null);

    await expect(
      fetchAndStoreSearchKeywordsForMonth(prisma as never, {
        googleLocationId: "unknown-loc",
        month: "2026-07",
        accountLabel: "agency-a",
      }),
    ).rejects.toThrow(/見つかりません/);

    expect(fetchSearchKeywords).not.toHaveBeenCalled();
  });

  // month のフォーマットが崩れている場合、Google APIを呼ぶ前に早期にエラーとする。
  it("month が YYYY-MM 形式でない場合はエラーになる", async () => {
    const prisma = createMockPrisma();

    await expect(
      fetchAndStoreSearchKeywordsForMonth(prisma as never, {
        googleLocationId: "loc-1",
        month: "2026/07",
        accountLabel: "agency-a",
      }),
    ).rejects.toThrow(/YYYY-MM/);
  });
});
