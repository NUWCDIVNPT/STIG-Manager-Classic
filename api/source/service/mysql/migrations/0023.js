const MigrationHandler = require('./lib/MigrationHandler')

const upMigration = [

  // table: revision
  `ALTER TABLE revision ADD COLUMN revisionStr VARCHAR(45) GENERATED ALWAYS AS (concat("V", \`version\`, "R", \`release\`)) AFTER \`release\``,
  `ALTER TABLE revision ADD INDEX idx_revision_benchmark_revisionStr (benchmarkId ASC, revisionStr ASC) VISIBLE`,

  // table: collection_rev
  `drop table if exists collection_rev_map`,
  `CREATE TABLE collection_rev_map (
    crId INT NOT NULL AUTO_INCREMENT,
    collectionId INT NOT NULL,
    benchmarkId VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs,
    revId VARCHAR(255) NOT NULL,
    PRIMARY KEY index1 (crId),
    UNIQUE KEY index_collection_benchmark (collectionId, benchmarkId),
    INDEX index_revId (revId),
    CONSTRAINT fk_collection_rev_map_1 FOREIGN KEY (collectionId) REFERENCES collection (collectionId) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  // view: v_default_rev
  `DROP VIEW IF EXISTS v_default_rev`,
  `CREATE VIEW v_default_rev AS
  SELECT DISTINCT
        a.collectionId AS collectionId,
        sa.benchmarkId AS benchmarkId,
        COALESCE(crm.revId, cr.revId) AS revId,
        CASE WHEN crm.revId IS NOT NULL THEN cast(true as json) ELSE cast(false as json) END as revisionPinned
    FROM
        asset a
        INNER JOIN stig_asset_map sa ON a.assetId = sa.assetId
        LEFT JOIN current_rev cr ON sa.benchmarkId = cr.benchmarkId
        LEFT JOIN collection_rev_map crm ON (sa.benchmarkId = crm.benchmarkId AND a.collectionId = crm.collectionId)`,

  // view: v_latest_rev
  `DROP VIEW IF EXISTS v_latest_rev`,
  `CREATE VIEW v_latest_rev AS
  select 
    rr.revId AS revId, 
    rr.benchmarkId AS benchmarkId,
    concat('V',rr.version,'R',rr.release) as revisionStr
  from 
    (
      select 
        r.revId, 
        r.benchmarkId,
        r.version,
        r.release,
        row_number() OVER (
          PARTITION BY r.benchmarkId 
          ORDER BY 
            field(
              r.status, 'draft', 'accepted'
            ) desc, 
            (r.version + 0) desc, 
            (r.release + 0) desc
        ) AS rn 
      from 
        revision r
    ) rr 
  where 
    (rr.rn = 1)`,

    `ALTER TABLE rev_group_rule_map
    DROP INDEX index4 ,
    ADD INDEX idx_version_check_digest (\`version\` ASC, checkDigest ASC) VISIBLE`
]

const downMigration = [
  `drop table if exists collection_rev_map`,
  `DROP VIEW IF EXISTS v_default_rev`
]

const migrationHandler = new MigrationHandler(upMigration, downMigration)
module.exports = {
  up: async (pool) => {
    await migrationHandler.up(pool, __filename)
  },
  down: async (pool) => {
    await migrationHandler.down(pool, __filename)
  }
}
