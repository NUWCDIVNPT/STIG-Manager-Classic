const MigrationHandler = require('./lib/MigrationHandler')

const upMigration = [

  // table: collection
  `ALTER TABLE collection 
  ADD COLUMN state ENUM('enabled','disabled','cloning') NOT NULL,
  ADD COLUMN createdUserId INT NULL,
  ADD COLUMN stateDate DATETIME NULL,
  ADD COLUMN stateUserId INT NULL,
  ADD COLUMN isEnabled TINYINT GENERATED ALWAYS AS (case when (state = 'enabled') then 1 else null end),
  DROP INDEX index2,
  ADD UNIQUE INDEX index2 (name ASC, isEnabled ASC) VISIBLE`,

  // table: asset
  `ALTER TABLE asset ADD COLUMN state ENUM('enabled','disabled') NOT NULL,
  ADD COLUMN stateDate DATETIME NULL,
  ADD COLUMN stateUserId INT NULL,
  ADD COLUMN isEnabled TINYINT GENERATED ALWAYS AS (case when (state = 'enabled') then 1 else null end),
  DROP INDEX INDEX_NAMECOLLECTION,
  ADD UNIQUE INDEX INDEX_NAME_COLLECTION_ENABLED (name ASC, collectionId ASC, isEnabled ASC) VISIBLE`,

  //table: procedure_log
  `CREATE TABLE procedure_log (
    id INT NOT NULL AUTO_INCREMENT,
    ts DATETIME NOT NULL,
    proc VARCHAR(45) NOT NULL,
    msg VARCHAR(45) NOT NULL,
    PRIMARY KEY (id))`,

  // procedure: deleteDisabledCollections
  `DROP procedure IF EXISTS deleteDisabledCollections`,
  `CREATE PROCEDURE deleteDisabledCollections()
  BEGIN
      REPEAT
      START TRANSACTION;
      DELETE FROM review_history WHERE reviewId IN (
        SELECT r.reviewId FROM review r INNER JOIN asset a using (assetId) INNER JOIN collection c using (collectionId) where c.state = "disabled"
      ) ORDER BY historyId DESC LIMIT 100000;
          SELECT ROW_COUNT() INTO @row_count;
          INSERT into procedure_log(ts, proc, msg) VALUES (CURRENT_TIMESTAMP(), 'review_history', @row_count);
          commit;
    UNTIL @row_count < 100000 END REPEAT;
  END`,
]

const downMigration = [
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
