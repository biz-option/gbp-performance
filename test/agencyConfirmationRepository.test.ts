// テスト対象: src/db/agencyConfirmationRepository.ts の advanceConfirmedThroughDate
//
// 何を守るテストか:
//   代理店の confirmedThroughDate(この日付以前は確定済みとみなせるウォーターマーク)を
//   いつ・どこまで前進させるかというロジック。前進させる条件を間違えると、
//   本当はまだ不確定なデータを確定済みとしてレポートしてしまったり、逆に
//   いつまで経っても確定扱いにならなかったりする。
// モックについて:
//   実DBには接続しない。PrismaClient の dailyMetric.findFirst / agency.findUniqueOrThrow /
//   agency.update を vi.fn() で差し替える。

import { describe, expect, it, vi } from "vitest";
import { advanceConfirmedThroughDate } from "../src/db/agencyConfirmationRepository.js";

function createMockClient() {
  return {
    dailyMetric: {
      findFirst: vi.fn(),
    },
    agency: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("advanceConfirmedThroughDate", () => {
  it("非0のメトリクスが1件でもあれば、fetchedDate の前日まで前進させる", async () => {
    const client = createMockClient();
    client.dailyMetric.findFirst.mockResolvedValue({ id: 1n });
    client.agency.findUniqueOrThrow.mockResolvedValue({ confirmedThroughDate: null });

    await advanceConfirmedThroughDate(client as never, {
      agencyId: 1,
      fetchedDate: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(client.dailyMetric.findFirst).toHaveBeenCalledWith({
      where: {
        metricDate: new Date("2026-07-20T00:00:00.000Z"),
        value: { not: 0 },
        location: { agencyId: 1 },
      },
      select: { id: true },
    });
    expect(client.agency.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { confirmedThroughDate: new Date("2026-07-19T00:00:00.000Z") },
    });
  });

  it("全て0(非0のメトリクスなし)の場合は何もしない — 個別の日付を再取得しに行かない設計のため", async () => {
    const client = createMockClient();
    client.dailyMetric.findFirst.mockResolvedValue(null);

    await advanceConfirmedThroughDate(client as never, {
      agencyId: 1,
      fetchedDate: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(client.agency.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(client.agency.update).not.toHaveBeenCalled();
  });

  it("既存の confirmedThroughDate の方が新しい場合は後退させない", async () => {
    const client = createMockClient();
    client.dailyMetric.findFirst.mockResolvedValue({ id: 1n });
    client.agency.findUniqueOrThrow.mockResolvedValue({
      confirmedThroughDate: new Date("2026-07-25T00:00:00.000Z"),
    });

    await advanceConfirmedThroughDate(client as never, {
      agencyId: 1,
      fetchedDate: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(client.agency.update).not.toHaveBeenCalled();
  });

  it("既存の confirmedThroughDate と候補日が同じ場合も更新しない(冪等性)", async () => {
    const client = createMockClient();
    client.dailyMetric.findFirst.mockResolvedValue({ id: 1n });
    client.agency.findUniqueOrThrow.mockResolvedValue({
      confirmedThroughDate: new Date("2026-07-19T00:00:00.000Z"),
    });

    await advanceConfirmedThroughDate(client as never, {
      agencyId: 1,
      fetchedDate: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(client.agency.update).not.toHaveBeenCalled();
  });
});
