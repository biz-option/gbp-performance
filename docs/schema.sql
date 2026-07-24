-- gbp-performance DB スキーマ (手動実行用DDL)
--
-- このファイルが DB スキーマの正(せい)です。Cloud SQL (MySQL) に対して
-- MySQLクライアント等で手動で実行してください。migration ツールは使用しません。
--
-- prisma/schema.prisma はこのファイルと手動で同期させます。スキーマを変更する場合は
-- 必ずこのファイルを先に更新し、同じ内容を prisma/schema.prisma にも反映してください。
-- `prisma migrate` / `prisma db push` はこのプロジェクトでは絶対に実行しないでください
-- (DBへの変更適用はすべて、このファイルを人間が確認した上での手動実行のみで行います)。
--
-- 外部キー制約(FK)は意図的に付与していません。整合性はアプリケーションコード側で担保します。

CREATE TABLE `agencies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `googleAccountId` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `locations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agencyId` INTEGER NOT NULL,
    `googleLocationId` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `locations_agencyId_googleLocationId_key`(`agencyId`, `googleLocationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `daily_metrics` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `locationId` INTEGER NOT NULL,
    `metricDate` DATE NOT NULL,
    `metricType` ENUM('BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'CALL_CLICKS', 'BUSINESS_BOOKINGS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS') NOT NULL,
    `value` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_metrics_metricDate_idx`(`metricDate`),
    UNIQUE INDEX `daily_metrics_locationId_metricDate_metricType_key`(`locationId`, `metricDate`, `metricType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `google_oauth_credentials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountLabel` VARCHAR(255) NOT NULL,
    `refreshToken` TEXT NOT NULL,
    `scope` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `google_oauth_credentials_accountLabel_key`(`accountLabel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 将来のバッチジョブ(3日後取得・0件フラグ・再試行ロジック)のためのステータス管理テーブル。
-- 現時点のコードでは未使用だが、DB作成時点でスキーマを揃えておく。
CREATE TABLE `location_metric_day_status` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `locationId` INTEGER NOT NULL,
    `metricDate` DATE NOT NULL,
    `status` ENUM('PENDING', 'AVAILABLE') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `location_metric_day_status_locationId_metricDate_key`(`locationId`, `metricDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
