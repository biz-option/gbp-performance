import type { PrismaClient } from "@prisma/client";
import { getAuthorizedClient } from "./oauthClient.js";
import { fetchSearchKeywords, type MonthComponents } from "./performanceApiClient.js";
import { upsertSearchKeywordMetric } from "../db/searchKeywordMetricsRepository.js";

export interface FetchAndStoreSearchKeywordsForMonthParams {
  googleLocationId: string;
  /** YYYY-MM 形式の月。 */
  month: string;
  accountLabel: string;
}

export interface FetchAndStoreSearchKeywordsForMonthSummary {
  locationId: number;
  metricMonth: string;
  stored: Array<{ searchKeyword: string; value: number | null; belowThreshold: number | null }>;
}

type Deps = Pick<PrismaClient, "location" | "googleOauthCredential" | "searchKeywordMetric">;

/**
 * 指定した1ロケーション・1か月分の検索キーワードランキングを Google API から取得し、
 * search_keyword_metrics に保存する単純な1回取得(いつ・どの月を取得するかの判断は
 * この関数の呼び出し側の責務)。
 */
export async function fetchAndStoreSearchKeywordsForMonth(
  prisma: Deps,
  params: FetchAndStoreSearchKeywordsForMonthParams,
): Promise<FetchAndStoreSearchKeywordsForMonthSummary> {
  const location = await prisma.location.findFirst({
    where: { googleLocationId: params.googleLocationId },
  });

  if (!location) {
    throw new Error(
      `googleLocationId=${params.googleLocationId} の location がDBに見つかりません。` +
        "先に locations テーブルへ登録してください(このスクリプトは location を作成しません)。",
    );
  }

  const authClient = await getAuthorizedClient(params.accountLabel, prisma);
  const monthComponents = parseMonthComponents(params.month);

  const rawKeywords = await fetchSearchKeywords(authClient, {
    googleLocationId: params.googleLocationId,
    month: monthComponents,
  });

  const metricMonth = new Date(`${params.month}-01T00:00:00.000Z`);
  const stored: FetchAndStoreSearchKeywordsForMonthSummary["stored"] = [];

  for (const entry of rawKeywords) {
    await upsertSearchKeywordMetric(prisma, {
      locationId: location.id,
      metricMonth,
      searchKeyword: entry.searchKeyword,
      value: entry.value,
      belowThreshold: entry.belowThreshold,
    });
    stored.push(entry);
  }

  return { locationId: location.id, metricMonth: params.month, stored };
}

function parseMonthComponents(month: string): MonthComponents {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    throw new Error(`month は YYYY-MM 形式で指定してください(渡された値: "${month}")`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}
