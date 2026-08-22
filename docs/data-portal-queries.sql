-- Looper Studio (旧 Googleデータポータル) のカスタムクエリ集。
-- ここに書かれたクエリはこのプロジェクトのコードからは実行されない、
-- Looker Studio側のデータソース設定に手動でコピー&ペーストして使うための控え。
--
-- daily_metrics(日次)と search_keyword_metrics(月次)は粒度・ディメンションの性質が
-- 異なる(前者は固定enumのmetricType、後者はフリーテキストのsearchKeyword、かつ
-- valueが閾値未満だとNULLになりbelowThresholdに入る)ため、1つのSQLにUNIONせず、
-- 別々のデータソースとしてLooker Studioに追加し、必要な場合のみ locationId / 月で
-- ブレンド(Blend Data)する運用とする。
--
-- 重要: 下記クエリ1(daily_metrics用)は既存のLooker Studioデータソースで
-- 使用中のクエリをそのまま転記したもの。このデータソースのクエリを直接編集すると、
-- そのデータソースを参照して作成済みの計算フィールドが無効化されることが確認されている
-- ため、絶対に上書き編集しないこと。クエリ2(search_keyword_metrics用)は、
-- 既存データソースとは別の「新規データソース」としてLooker Studioに追加する。

-- ============================================================
-- 1. daily_metrics 用 (既存データソース。参考掲載のみ、編集不要)
-- ============================================================
SELECT
  l.agencyId,
  a.name AS agency_name,
  m.locationId,
  l.name AS location_name,
  l.createdAt AS location_created_at,
  m.metricDate,
  m.metricType,
  m.value,
  -- metricDateがlocationsの作成日より前かどうかでデータを区別するフラグ
  CASE
    WHEN m.metricDate < DATE(l.createdAt) THEN '手動取得 (システム登録前)'
    ELSE '自動取得 (システム登録後)'
  END AS data_source_type,
  -- 登録月の何ヶ月前かを示す相対月フラグ(例: 登録月の前月なら -1、2ヶ月前なら -2)
  TIMESTAMPDIFF(
    MONTH,
    DATE_FORMAT(l.createdAt, '%Y-%m-01'),
    DATE_FORMAT(m.metricDate, '%Y-%m-01')
  ) AS relative_month
FROM daily_metrics m
JOIN locations l ON m.locationId = l.id
LEFT JOIN agencies a ON l.agencyId = a.id;

-- ============================================================
-- 2. search_keyword_metrics 用 (Looker Studio に「新規データソース」として追加する)
-- ============================================================
-- data_source_type の判定は日単位ではなく月単位で比較する(metricMonthが月次データのため。
-- 日単位の生比較(daily_metricsと同じ書き方)のままだと、例えば
-- 「locationが7/15に作成され、7/1始まりの7月分データがある」場合に
-- 7/1 < 7/15 で誤って「手動取得」判定になってしまう)。
SELECT
  l.agencyId,
  a.name AS agency_name,
  s.locationId,
  l.name AS location_name,
  l.createdAt AS location_created_at,
  s.metricMonth,
  s.searchKeyword,
  s.value,
  s.belowThreshold,
  -- value/belowThresholdをまとめた表示用文字列(PDFの「< 15」相当)
  CASE
    WHEN s.value IS NOT NULL THEN CAST(s.value AS CHAR)
    ELSE CONCAT('< ', s.belowThreshold)
  END AS display_value,
  -- metricMonthがlocationsの作成月より前かどうかでデータを区別するフラグ
  CASE
    WHEN DATE_FORMAT(s.metricMonth, '%Y-%m') < DATE_FORMAT(l.createdAt, '%Y-%m')
      THEN '手動取得 (システム登録前)'
    ELSE '自動取得 (システム登録後)'
  END AS data_source_type,
  -- 登録月の何ヶ月前かを示す相対月フラグ
  TIMESTAMPDIFF(
    MONTH,
    DATE_FORMAT(l.createdAt, '%Y-%m-01'),
    DATE_FORMAT(s.metricMonth, '%Y-%m-01')
  ) AS relative_month
FROM search_keyword_metrics s
JOIN locations l ON s.locationId = l.id
LEFT JOIN agencies a ON l.agencyId = a.id;
