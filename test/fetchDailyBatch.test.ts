// テスト対象: src/google/fetchDailyBatch.ts の runDailyBatch
//
// 何を守るテストか:
//   全locationを巡回し、「実行日の5日前」までの未取得日をキャッチアップして取得する
//   というバッチの巡回ロジック。個々の取得処理(fetchAndStoreOneDay)は別ファイルで
//   単体テスト済みなので、ここでは「どの日付を・何回・どの引数で呼び出すか」だけを見る。
//   このプロジェクトは単一Googleアカウントを前提としているため、accountLabel は
//   代理店ごとではなく getSoleAccountLabel で1回だけ解決される想定。
// モックについて:
//   fetchAndStoreOneDay・getLastMetricDate・getSoleAccountLabel を vi.mock で丸ごと差し替える。
//   Prisma(location.findMany)はオブジェクトごと vi.fn() で差し替え、実DBに接続しない。

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/google/fetchAndStoreOneDay.js", () => ({
  fetchAndStoreOneDay: vi.fn(),
}));

vi.mock("../src/google/oauthClient.js", () => ({
  getSoleAccountLabel: vi.fn(),
}));

vi.mock("../src/db/dailyMetricsRepository.js", () => ({
  getLastMetricDate: vi.fn(),
}));

const { fetchAndStoreOneDay } = await import("../src/google/fetchAndStoreOneDay.js");
const { getSoleAccountLabel } = await import("../src/google/oauthClient.js");
const { getLastMetricDate } = await import("../src/db/dailyMetricsRepository.js");
const { runDailyBatch } = await import("../src/google/fetchDailyBatch.js");

function createMockPrisma(locations: unknown[]) {
  return {
    location: {
      findMany: vi.fn().mockResolvedValue(locations),
    },
  };
}

const NOW = new Date("2026-07-20T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSoleAccountLabel).mockResolvedValue("agency-a");
  vi.mocked(fetchAndStoreOneDay).mockResolvedValue({
    locationId: 1,
    metricDate: "dummy",
    stored: [],
    skipped: [],
  });
});

describe("runDailyBatch", () => {
  it("初回取得(保存済みデータなし)の location は上限日(実行日の5日前)を1日だけ取得する", async () => {
    vi.mocked(getLastMetricDate).mockResolvedValue(null);
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    const summary = await runDailyBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreOneDay).toHaveBeenCalledTimes(1);
    expect(fetchAndStoreOneDay).toHaveBeenCalledWith(prisma, {
      googleLocationId: "loc-1",
      date: "2026-07-15",
      accountLabel: "agency-a",
    });
    expect(summary.succeeded).toEqual([{ locationId: 1, date: "2026-07-15" }]);
  });

  it("バッチが数日止まっていた場合、欠損している日をまとめて取得する(キャッチアップ)", async () => {
    vi.mocked(getLastMetricDate).mockResolvedValue(new Date("2026-07-12T00:00:00.000Z"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    await runDailyBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreOneDay).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetchAndStoreOneDay).mock.calls.map((call) => call[1].date)).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
  });

  it("既に上限日まで取得済みの location は何も取得しない", async () => {
    vi.mocked(getLastMetricDate).mockResolvedValue(new Date("2026-07-15T00:00:00.000Z"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    const summary = await runDailyBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreOneDay).not.toHaveBeenCalled();
    expect(summary.succeeded).toEqual([]);
  });

  it("google_oauth_credentials が未登録・複数登録などで accountLabel が解決できない場合、location処理前に失敗する", async () => {
    vi.mocked(getSoleAccountLabel).mockRejectedValue(new Error("認証情報が登録されていません"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    await expect(runDailyBatch(prisma as never, { now: NOW })).rejects.toThrow(
      "認証情報が登録されていません",
    );
    expect(getLastMetricDate).not.toHaveBeenCalled();
    expect(fetchAndStoreOneDay).not.toHaveBeenCalled();
  });

  // 失敗した日をまたいで後続日だけ保存されると、次回実行時の再開位置(MAX(metricDate))が
  // 失敗日を追い越してしまい、失敗日が永久に再取得されなくなる。それを防ぐため、
  // 失敗した時点でそのlocationの以降の日付は取得しに行かないことを確認する。
  it("1日の取得が失敗したら、そのlocationの以降の日付は取得しにいかない", async () => {
    vi.mocked(getLastMetricDate).mockResolvedValue(new Date("2026-07-12T00:00:00.000Z"));
    vi.mocked(fetchAndStoreOneDay).mockRejectedValueOnce(new Error("API error"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    const summary = await runDailyBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreOneDay).toHaveBeenCalledTimes(1);
    expect(fetchAndStoreOneDay).toHaveBeenCalledWith(prisma, {
      googleLocationId: "loc-1",
      date: "2026-07-13",
      accountLabel: "agency-a",
    });
    expect(summary.failed).toEqual([
      { locationId: 1, date: "2026-07-13", error: new Error("API error") },
    ]);
    expect(summary.succeeded).toEqual([]);
  });

  // 上のテストの続き: 失敗日がDBに保存されなかった(=MAX(metricDate)が進んでいない)ことを
  // 前提に次回実行すると、同じ日付が再取得対象になる(=失敗日が永久にスキップされない)ことを確認する。
  it("失敗した日は次回実行時に再取得される(再開位置が失敗日を追い越さない)", async () => {
    vi.mocked(getLastMetricDate).mockResolvedValue(new Date("2026-07-12T00:00:00.000Z"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    vi.mocked(fetchAndStoreOneDay).mockRejectedValueOnce(new Error("API error"));
    await runDailyBatch(prisma as never, { now: NOW });

    // 1回目の失敗によりDBには何も保存されていないため、getLastMetricDate の返り値は変わらない
    // (実DBではこれは MAX(metricDate) が前回と同じであることに相当する)。
    vi.mocked(fetchAndStoreOneDay).mockResolvedValue({
      locationId: 1,
      metricDate: "dummy",
      stored: [],
      skipped: [],
    });
    const secondSummary = await runDailyBatch(prisma as never, { now: NOW });

    // calls[0] は1回目実行(失敗した07-13)。2回目実行の最初の呼び出し(calls[1])が
    // 07-14からではなく07-13から再開していることを確認する。
    expect(vi.mocked(fetchAndStoreOneDay).mock.calls[1]?.[1]).toMatchObject({
      date: "2026-07-13",
    });
    expect(secondSummary.succeeded).toEqual([
      { locationId: 1, date: "2026-07-13" },
      { locationId: 1, date: "2026-07-14" },
      { locationId: 1, date: "2026-07-15" },
    ]);
  });
});
