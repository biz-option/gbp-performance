// テスト対象: src/google/fetchSearchKeywordsBatch.ts の runSearchKeywordsBatch
//
// 何を守るテストか:
//   全locationを巡回し、「実行日の5日前の時点で、既に完全に終わっている直近の月」までの
//   未取得月をキャッチアップして取得する、というバッチの巡回ロジック。個々の取得処理
//   (fetchAndStoreSearchKeywordsForMonth)は別ファイルで単体テスト済みなので、
//   ここでは「どの月を・何回・どの引数で呼び出すか」だけを見る。
//   このプロジェクトは単一Googleアカウントを前提としているため、accountLabel は
//   代理店ごとではなく getSoleAccountLabel で1回だけ解決される想定。
// モックについて:
//   fetchAndStoreSearchKeywordsForMonth・getLastSearchKeywordMonth・getSoleAccountLabel を
//   vi.mock で丸ごと差し替える。Prisma(location.findMany)はオブジェクトごと vi.fn() で
//   差し替え、実DBに接続しない。

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/google/fetchAndStoreSearchKeywordsForMonth.js", () => ({
  fetchAndStoreSearchKeywordsForMonth: vi.fn(),
}));

vi.mock("../src/google/oauthClient.js", () => ({
  getSoleAccountLabel: vi.fn(),
}));

vi.mock("../src/db/searchKeywordMetricsRepository.js", () => ({
  getLastSearchKeywordMonth: vi.fn(),
}));

const { fetchAndStoreSearchKeywordsForMonth } = await import(
  "../src/google/fetchAndStoreSearchKeywordsForMonth.js"
);
const { getSoleAccountLabel } = await import("../src/google/oauthClient.js");
const { getLastSearchKeywordMonth } = await import("../src/db/searchKeywordMetricsRepository.js");
const { runSearchKeywordsBatch } = await import("../src/google/fetchSearchKeywordsBatch.js");

function createMockPrisma(locations: unknown[]) {
  return {
    location: {
      findMany: vi.fn().mockResolvedValue(locations),
    },
  };
}

// 実行日の5日前(07-15)が属する月(2026-07)の前月、つまり 2026-06 が取得上限月になる。
const NOW = new Date("2026-07-20T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSoleAccountLabel).mockResolvedValue("agency-a");
  vi.mocked(fetchAndStoreSearchKeywordsForMonth).mockResolvedValue({
    locationId: 1,
    metricMonth: "dummy",
    stored: [],
  });
});

describe("runSearchKeywordsBatch", () => {
  it("初回取得(保存済みデータなし)の location は上限月(2026-06)を1か月だけ取得する", async () => {
    vi.mocked(getLastSearchKeywordMonth).mockResolvedValue(null);
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    const summary = await runSearchKeywordsBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreSearchKeywordsForMonth).toHaveBeenCalledTimes(1);
    expect(fetchAndStoreSearchKeywordsForMonth).toHaveBeenCalledWith(prisma, {
      googleLocationId: "loc-1",
      month: "2026-06",
      accountLabel: "agency-a",
    });
    expect(summary.succeeded).toEqual([{ locationId: 1, month: "2026-06" }]);
  });

  it("バッチが数か月止まっていた場合、欠損している月をまとめて取得する(キャッチアップ)", async () => {
    vi.mocked(getLastSearchKeywordMonth).mockResolvedValue(new Date("2026-03-01T00:00:00.000Z"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    await runSearchKeywordsBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreSearchKeywordsForMonth).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(fetchAndStoreSearchKeywordsForMonth).mock.calls.map((call) => call[1].month),
    ).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("既に上限月まで取得済みの location は何も取得しない", async () => {
    vi.mocked(getLastSearchKeywordMonth).mockResolvedValue(new Date("2026-06-01T00:00:00.000Z"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    const summary = await runSearchKeywordsBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreSearchKeywordsForMonth).not.toHaveBeenCalled();
    expect(summary.succeeded).toEqual([]);
  });

  it("google_oauth_credentials が未登録・複数登録などで accountLabel が解決できない場合、location処理前に失敗する", async () => {
    vi.mocked(getSoleAccountLabel).mockRejectedValue(new Error("認証情報が登録されていません"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    await expect(runSearchKeywordsBatch(prisma as never, { now: NOW })).rejects.toThrow(
      "認証情報が登録されていません",
    );
    expect(getLastSearchKeywordMonth).not.toHaveBeenCalled();
    expect(fetchAndStoreSearchKeywordsForMonth).not.toHaveBeenCalled();
  });

  // 失敗した月をまたいで後続月だけ保存されると、次回実行時の再開位置(MAX(metricMonth))が
  // 失敗月を追い越してしまい、失敗月が永久に再取得されなくなる。それを防ぐため、
  // 失敗した時点でそのlocationの以降の月は取得しに行かないことを確認する。
  it("1か月の取得が失敗したら、そのlocationの以降の月は取得しにいかない", async () => {
    vi.mocked(getLastSearchKeywordMonth).mockResolvedValue(new Date("2026-03-01T00:00:00.000Z"));
    vi.mocked(fetchAndStoreSearchKeywordsForMonth).mockRejectedValueOnce(new Error("API error"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    const summary = await runSearchKeywordsBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreSearchKeywordsForMonth).toHaveBeenCalledTimes(1);
    expect(fetchAndStoreSearchKeywordsForMonth).toHaveBeenCalledWith(prisma, {
      googleLocationId: "loc-1",
      month: "2026-04",
      accountLabel: "agency-a",
    });
    expect(summary.failed).toEqual([
      { locationId: 1, month: "2026-04", error: new Error("API error") },
    ]);
    expect(summary.succeeded).toEqual([]);
  });

  // 上のテストの続き: 失敗月がDBに保存されなかった(=MAX(metricMonth)が進んでいない)ことを
  // 前提に次回実行すると、同じ月が再取得対象になる(=失敗月が永久にスキップされない)ことを確認する。
  it("失敗した月は次回実行時に再取得される(再開位置が失敗月を追い越さない)", async () => {
    vi.mocked(getLastSearchKeywordMonth).mockResolvedValue(new Date("2026-03-01T00:00:00.000Z"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    vi.mocked(fetchAndStoreSearchKeywordsForMonth).mockRejectedValueOnce(new Error("API error"));
    await runSearchKeywordsBatch(prisma as never, { now: NOW });

    // 1回目の失敗によりDBには何も保存されていないため、getLastSearchKeywordMonth の返り値は
    // 変わらない(実DBではこれは MAX(metricMonth) が前回と同じであることに相当する)。
    vi.mocked(fetchAndStoreSearchKeywordsForMonth).mockResolvedValue({
      locationId: 1,
      metricMonth: "dummy",
      stored: [],
    });
    const secondSummary = await runSearchKeywordsBatch(prisma as never, { now: NOW });

    // calls[0] は1回目実行(失敗した2026-04)。2回目実行の最初の呼び出し(calls[1])が
    // 2026-05からではなく2026-04から再開していることを確認する。
    expect(vi.mocked(fetchAndStoreSearchKeywordsForMonth).mock.calls[1]?.[1]).toMatchObject({
      month: "2026-04",
    });
    expect(secondSummary.succeeded).toEqual([
      { locationId: 1, month: "2026-04" },
      { locationId: 1, month: "2026-05" },
      { locationId: 1, month: "2026-06" },
    ]);
  });
});
