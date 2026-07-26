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

  it("1日の取得が失敗しても他の日の処理は継続し、failed に記録される", async () => {
    vi.mocked(getLastMetricDate).mockResolvedValue(new Date("2026-07-12T00:00:00.000Z"));
    vi.mocked(fetchAndStoreOneDay).mockRejectedValueOnce(new Error("API error"));
    const prisma = createMockPrisma([{ id: 1, agencyId: 10, googleLocationId: "loc-1" }]);

    const summary = await runDailyBatch(prisma as never, { now: NOW });

    expect(fetchAndStoreOneDay).toHaveBeenCalledTimes(3);
    expect(summary.failed).toEqual([
      { locationId: 1, date: "2026-07-13", error: new Error("API error") },
    ]);
    expect(summary.succeeded).toEqual([
      { locationId: 1, date: "2026-07-14" },
      { locationId: 1, date: "2026-07-15" },
    ]);
  });
});
