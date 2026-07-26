// テスト対象: src/db/agencyConfirmationRepository.ts の advanceConfirmedThroughDate
//
// 何を守るテストか:
//   代理店の confirmedThroughDate(この日付以前は確定済みとみなせるウォーターマーク)を
//   いつ・どこまで前進させるかというロジック。前進させる条件を間違えると、
//   本当はまだ不確定なデータを確定済みとしてレポートしてしまったり、逆に
//   いつまで経っても確定扱いにならなかったりする。
//   前進条件(null または candidateWatermark より過去)を updateMany の WHERE 句に
//   含めることで、read-then-write のレースなしにDB側でアトミックに判定させている。
// モックについて:
//   実DBには接続しない。PrismaClient の dailyMetric.findFirst / agency.updateMany を
//   vi.fn() で差し替える。

import { describe, expect, it, vi } from "vitest";
import { advanceConfirmedThroughDate } from "../src/db/agencyConfirmationRepository.js";

function createMockClient() {
  return {
    dailyMetric: {
      findFirst: vi.fn(),
    },
    agency: {
      updateMany: vi.fn(),
    },
  };
}

describe("advanceConfirmedThroughDate", () => {
  it("非0のメトリクスが1件でもあれば、fetchedDate の前日まで前進させる(null or 過去日のときだけ)", async () => {
    const client = createMockClient();
    client.dailyMetric.findFirst.mockResolvedValue({ id: 1n });

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
    expect(client.agency.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1,
        OR: [
          { confirmedThroughDate: null },
          { confirmedThroughDate: { lt: new Date("2026-07-19T00:00:00.000Z") } },
        ],
      },
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

    expect(client.agency.updateMany).not.toHaveBeenCalled();
  });
});
