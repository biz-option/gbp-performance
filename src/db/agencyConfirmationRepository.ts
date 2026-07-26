import type { PrismaClient } from "@prisma/client";

export interface AdvanceConfirmedThroughDateInput {
  agencyId: number;
  /** この日付でメトリクスを取得し終えた、という基準日。 */
  fetchedDate: Date;
}

type ConfirmationClient = Pick<PrismaClient, "dailyMetric" | "agency">;

/**
 * fetchedDate に非0のメトリクスが1件でもあれば、その代理店のパイプラインが
 * fetchedDate まで到達している証拠とみなし、confirmedThroughDate を
 * fetchedDate の前日まで前進させる(後退はさせない)。
 * fetchedDate が全て0(または未取得)の場合は何もしない
 * — 個々の日付を再取得することはせず、将来の日付で非0が観測された時点で
 * まとめて確定扱いに含まれるのを待つ。
 */
export async function advanceConfirmedThroughDate(
  client: ConfirmationClient,
  input: AdvanceConfirmedThroughDateInput,
): Promise<void> {
  const hasNonZeroMetric = await client.dailyMetric.findFirst({
    where: {
      metricDate: input.fetchedDate,
      value: { not: 0 },
      location: { agencyId: input.agencyId },
    },
    select: { id: true },
  });

  if (!hasNonZeroMetric) {
    return;
  }

  const candidateWatermark = addDays(input.fetchedDate, -1);

  const agency = await client.agency.findUniqueOrThrow({
    where: { id: input.agencyId },
    select: { confirmedThroughDate: true },
  });

  if (agency.confirmedThroughDate && agency.confirmedThroughDate >= candidateWatermark) {
    return;
  }

  await client.agency.update({
    where: { id: input.agencyId },
    data: { confirmedThroughDate: candidateWatermark },
  });
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
