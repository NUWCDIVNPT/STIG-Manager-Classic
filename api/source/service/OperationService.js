'use strict';
const dbUtils = require('./utils')
const config = require('../utils/config')
const logger = require('../utils/logger')
const BJSON = require('../utils/buffer-json')
const { Readable, Transform } = require("node:stream")
const { pipeline } = require("node:stream/promises")
const zlib = require("node:zlib")
const klona = require('../utils/klona')
const os = require('node:os')
const Umzug = require('umzug')
const path = require('path')

/**
 * Return version information
 *
 * returns ApiVersion
 **/
exports.getConfiguration = async function() {
  const sql = `SELECT * from config`
  const [rows] = await dbUtils.pool.query(sql)
  const config = {}
  for (const row of rows) {
    config[row.key] = row.value
  }
  return (config)
}

exports.setConfigurationItem = async function (key, value) {
  const sql = 'INSERT INTO config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)'
  await dbUtils.pool.query(sql, [key, value])
  return (true)
}

/**
 * getAppData - streams JSONL records to the response. The JSONL are either
 * data records from a MySQL table (always an array) or metadata records (always an object).
 * 
 * @param {import('express').Response} res express response
 * @returns {undefined}
 * @example Abbreviated example of JSONL which is streamed to the response:
 *  {"version":"1.4.13","commit":{"branch":"na","sha":"na","tag":"na","describe":"na"},"date":"2024-08-18T15:29:16.784Z","lastMigration":33}\n
    {"tables":[{"table":"stig","rowCount":4}, ... ], "totalRows": 4}\n
    {"table":"stig","columns":"`benchmarkId`, `title`","rowCount":4}\n
    ["RHEL_7_STIG_TEST","Red Hat Enterprise Linux 7 Security Technical Implementation Guide"]\n
    ["VPN_SRG_TEST","Virtual Private Network (VPN) Security Requirements Guide"]\n
    ["VPN_SRG_Rule-fingerprint-match-test","Virtual Private Network (VPN) Security Requirements Guide - replaced"]\n
    ["Windows_10_STIG_TEST","Windows 10 Security Technical Implementation Guide"]\n ...
 */
exports.getAppData = async function (res, format) {
  /** @type {string[]} tables to exclude from the appdata file */
  const excludedTables = [
    '_migrations', 
    'status', 
    'result',
    'severity_cat_map', 
    'cci', 
    'cci_reference_map', 
    'config'
  ]

  let sink
  if (format === 'gzip') {
    /** @type {zlib.Gzip} transform stream to compress JSONL records and write to the response */
    sink = zlib.createGzip()
    sink.pipe(res)
  }
  else {
    /** @type {http.ServerResponse} */
    sink = res
  }
  sink.setMaxListeners(Infinity)


  // Write metadata record {version, commit, date, lastMigration}
  const {version, commit, lastMigration} = config
  sink.write(JSON.stringify({version, commit, date: new Date(), lastMigration}) + '\n')
   
  // Execute SQL to retrieve a list of tables and their non-generated columns. The query binds
  // to the schema name and the excluded tables.
  /** @type {Array.<Array.<{table:string, columns:string[]}>} */
  const [tableRows] = await dbUtils.pool.query(`SELECT
    TABLE_NAME as \`table\`,
    json_arrayagg(CONCAT('\`',COLUMN_NAME,'\`')) as columns
  FROM
    INFORMATION_SCHEMA.COLUMNS 
  where
    TABLE_SCHEMA=? 
    and TABLE_NAME IN (select TABLE_NAME FROM INFORMATION_SCHEMA.TABLES where TABLE_SCHEMA=? and TABLE_TYPE='BASE TABLE')
    and TABLE_NAME not in (?)
    and EXTRA NOT LIKE '% GENERATED'
  group by
    TABLE_NAME`, [config.database.schema, config.database.schema, excludedTables])

  /**
   * @type {Object.<string, {columns:string, rowCount?:number}>} object pivoted from tableRows[]
   * @example
   * '{
        "asset": {
          "columns": "`assetId`,`name`,`fqdn`, ... "
        },
        "check_content": {
          "columns": "`ccId`,`content`"
        },
        "collection": {
          "columns": "`collectionId`,`name`,`description`, ... "
        }
      }'
   */
  const tableMetadata = tableRows.reduce((acc, value) => {
    acc[value.table] = {columns:value.columns.join(',')}
    return acc
  }, {})


  /** @type {string[]} */
  const tableNames = Object.keys(tableMetadata)

  /** @type {number} incremented by the row count of each table */
  let totalRows = 0

  /** @type {{table:string, rowCount:number}[]} */
  let tables = []

  // Select and handle the row count for each table. 
  for (const table of tableNames) {
    const [row] = await dbUtils.pool.query(`select count(*) as cnt from ${table}`)
    const rowCount = row[0].cnt
    tableMetadata[table].rowCount = rowCount
    tables.push({table, rowCount})
    totalRows += rowCount
  }

  // Write metadata record {tables, totalRows}
  sink.write(JSON.stringify({tables, totalRows}) + '\n')

  for (const table of tableNames) {
    // create readable stream using the non-promise interface of dbUtils.pool.pool
    // select all rows for non-generated columns in table
    // perform custom type casting of fields to JS
    /** @type {Readable} */
    const queryStream = dbUtils.pool.pool.query({
      sql: `select ${tableMetadata[table].columns} from ${table}`,
      rowsAsArray: true,
      typeCast: function (field, next) {
         // BIT fields returned as boolean
        if ((field.type === "BIT") && (field.length === 1)) {
          let bytes = field.buffer() || [0]
          return (bytes[0] === 1)
        }
         // Designated fields returned as original MySQL strings
        if (field.type === 'JSON' || field.type === 'DATETIME' || field.type === 'DATE') {
          return (field.string("utf8"))
        }
        return next()
      }
     }).stream()

    // Write metadata record {table, columns, rowCount}
    sink.write(JSON.stringify({table, ...tableMetadata[table]}) + '\n')

    /** @type {Transform} writes a JSONL data record for each tuple of row data*/
    const bjson = new Transform({
      objectMode: true,
      transform: (data, encoding, cb) => {
        // BSJON supports stringify() and parse() of Buffer values
        cb(null, BJSON.stringify(data) + '\n')
      }
    })

    // pipeline writes data records [field, field, ...] to sink, ends without closing sink
    await pipeline(queryStream, bjson, sink, { end: false })
  }

  // ending sink will also end the response
  sink.end()
}

exports.getAppDataTables = async function () {
  const sql = `SELECT
    TABLE_NAME as name,
    TABLE_ROWS as \`rows\`,
    DATA_LENGTH as dataLength
  FROM
    information_schema.TABLES
  WHERE
    TABLE_SCHEMA=? and TABLE_TYPE='BASE TABLE'
  ORDER BY
    TABLE_NAME`
  const [rows] = await dbUtils.pool.query(sql, [config.database.schema])
  return (rows)
}

/**
 * replaceAppData - process a file created by getAppData() and execute SQL queries with progress messages
 * 
 * @param {Buffer} buffer - buffer with file content
 * @param {function(Object)} progressCb - optional, argument is an object with progress status
 * @returns {Promise} promise
 */
exports.replaceAppData = async function (buffer, contentType, progressCb = () => {}) {
  /**
   * ParseJSONLStream - Transform chunks of JSONL records into individual parsed AppData records (N:1).
   * @extends Transform
   */
  
  /** @type {boolean} needsMigrations - indicates if migrations are required */
  let needsMigrations = false
  class ParseJSONLStream extends Transform {
    /**
     * @param {Object} param
     * @param {function(string):any} param.jsonParser - function for JSON parsing, default JSON.parse()
     * @param {string} param.separator - character separating JSONL records, default '\n'
     */
    constructor({jsonParser = JSON.parse, separator = '\n'} = {}) {
      super({objectMode: true})
      Object.assign(this, {separator, jsonParser})
  
      /** @type {RegExp} RegExp for .split() that includes any trailing separator */
      this.splitRegExp = new RegExp(`(?<=${separator})`)
  
      /** @type {string} holds incoming chunk prefaced by any partial record from previous transform */
      this.buffer = '' 
    }

    /**
     * @param {Buffer} chunk - buffer from Gunzip that can span multiple JSONL records
     * @param {string} encoding - usually 'utf8'
     * @param {function()} cb - signals completion
     */
    _transform(chunk, encoding, cb) {
      this.buffer += chunk.toString(encoding)
      
      /** @type {string[]} list of JSONL, last item might be truncated or partial */
      const candidates = this.buffer.split(this.splitRegExp)
      /** @type {number} index of last candidates[] item */
      const lastIndex = candidates.length - 1

      // clear buffer for the next _transform() or _flush()
      this.buffer = ''
  
      /** index @type {number} */
      /** candidate @type {string} */
      for (const [index, candidate] of candidates.entries()) {
        if (index === lastIndex && !candidate.endsWith(this.separator)) {
          // this is the last candidate and there's no trailing separator
          // initialize buffer for next _transform() or _flush()
          this.buffer = candidate
        }
        else {
          try {
            // if parsable, write parsed value
            this.push(this.jsonParser(candidate))
          }
          // swallow any parse error
          catch {}
        }
      }
      cb()
    }
    /** @param {function()} cb signals completion */
    _flush(cb) {
      try {
        // if what's left in the buffer is parsable, write parsed value
        if (this.buffer) this.push(this.jsonParser(this.buffer))
      }
      // swallow any parse error
      catch {}
      cb()
    }
  }

  /**
   * AppDataQueryStream - Transform AppData records into an SQL query object (N:1)
   * @extends Transform
   */
  class AppDataQueryStream extends Transform {
    /**
     * @param {Object} param
     * @param {number} param.maxValues - maximum number of values for an insert query.
     * @param {function(Object): any} param.onTablesFn - called when record {tables, ...} is read
     * @param {function(Object): any} param.onMigrationFn - called when record {..., lastMigration} is read
     */
    constructor({maxValues = 10000, onTablesFn = new Function(), onMigrationFn = async function () {}}) {
      super({objectMode: true})
      Object.assign(this, { maxValues, onTablesFn, onMigrationFn })
      
      /** @type {null|Object} the last metadata record encountered */
      this.currentMetadata = null
      
      /** @type {Array} values for an insert query */
      this.currentBinds = []
    }

    /**
     * @param {Buffer} chunk a single AppData record
     * @param {string} encoding usually 'utf8'
     * @param {function()} cb signals completion
     */
    async _transform(chunk, encoding, cb) {
      if (Array.isArray(chunk)) {
        this.currentBinds.push(chunk)
        if (this.currentBinds.length === this.maxValues || this.currentBinds.length === 0) {
          this.push(this.formatCurrentQuery())
          this.currentBinds = []
        }
      }
      else if (chunk.lastMigration) {
        try {
          await this.onMigrationFn(chunk)
        }
        catch (e) {
          cb(e)
          return
        }
      }
      else if (chunk.table){
        if (this.currentMetadata) { 
          this.push(this.formatCurrentQuery())
        }
        this.currentMetadata = chunk
        this.currentBinds = []
        this.push(this.formatCurrentQuery())
      }
      else if (chunk.tables) {
        try {
          this.onTablesFn(chunk)
        }
        catch (e) {
          cb(e)
          return
        }
      }
      else {
        this.currentMetadata = null
      }
      cb()
    }
    
    /** @param {function()} cb signals completion */
    _flush(cb) {
      this.push(this.formatCurrentQuery())
      cb()
    }

    /** 
     * Creates an object with an SQL insert or truncate statement that operates
     * on the current table and any current binds
     * @returns {{table:string, sql:string, valueCount:number}} */
    formatCurrentQuery() {
      const sqlInsert = this.currentBinds.length
        ? `insert into ${this.currentMetadata.table}(${this.currentMetadata.columns}) values ?`
        : `truncate ${this.currentMetadata.table}`
      return {
        table: this.currentMetadata.table,
        sql: dbUtils.pool.format(sqlInsert, [this.currentBinds]),
        valueCount: this.currentBinds.length
      }
    }
  }

  /** 
   * @param {any} record expected to be AppData metadata {..., lastMigration}
   * @returns {undefined}
   * @throws {Error}
   */
  async function onMigrationFn(record) {
    if (record.lastMigration === config.lastMigration) return
    if (record.lastMigration > config.lastMigration) {
      throw new Error(`API migration v${config.lastMigration} is less than the source migration v${record.lastMigration}`) 
    }
    needsMigrations = true
    await resetDatabase()
    await migrateTo(record.lastMigration)
  }

  async function migrateTo(migration = config.lastMigration) {
    const endMigration = migration.toString().padStart(4, '0') + '.js'
    const umzug = new Umzug({
      migrations: {
        path: path.join(__dirname, './migrations'),
        params: [dbUtils.pool]
      },
      storage: path.join(__dirname, './migrations/lib/umzug-mysql-storage'),
      storageOptions: {
        pool: dbUtils.pool
      }
    })
    umzug.on('migrating', (name) => {
      progressCb({migration: name, status: 'started'})
    })
    umzug.on('migrated', (name) => {
      progressCb({migration: name, status: 'finished'})
    })
    await umzug.up({to: endMigration})
  }

  async function resetDatabase() {
    const connection = await dbUtils.pool.getConnection()
    const sql = `SELECT
    table_name,
    table_type
      FROM
        information_schema.TABLES
      WHERE
        TABLE_SCHEMA=?`
    const [tables] = await connection.query(sql,[config.database.schema])
    await connection.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of tables) {
      const drop = `DROP ${table.TABLE_TYPE === 'BASE TABLE' ? 'TABLE' : 'VIEW'} ${table.TABLE_NAME}`
      await connection.query(drop)
      progressCb({sql: drop})
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1')
    await connection.release()
  }

  function createChunkedReadable(buffer, chunkSize = 64 * 1024) {
    let offset = 0
    return new Readable({
      read() {
        if (offset >= buffer.length) {
          this.push(null) // No more data, signal end of stream
        } 
        else {
          const chunk = buffer.subarray(offset, offset + chunkSize)
          this.push(chunk) // Push the next chunk
          offset += chunkSize
        }
      }
    })
  }
  
  /** @type {import('mysql2/promise').PoolConnection} */
  let connection
  try {
    connection = await dbUtils.pool.getConnection()
    await connection.query('SET FOREIGN_KEY_CHECKS=0')
    const jsonl = new ParseJSONLStream({jsonParser: BJSON.parse})
    const queries = new AppDataQueryStream({maxValues: 10000, onTablesFn: progressCb, onMigrationFn})
    if (contentType === 'application/gzip' || contentType === 'application/x-gzip') {
      pipeline(Readable.from(buffer), zlib.createGunzip(), jsonl, queries)
    }
    else {
      pipeline(createChunkedReadable(buffer, 10 * 1024 * 1024), jsonl, queries)
    }
    let seq = 0
    for await (const data of queries) {
      await connection.query(data.sql)
      seq++
      progressCb({seq, table: data.table, valueCount: data.valueCount})
    }
    if (needsMigrations) await migrateTo(config.lastMigration)
    progressCb({status: 'success'})

  }
  catch (err) {
    progressCb({status: 'fail', error: err.message})
    return undefined
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.query('SET FOREIGN_KEY_CHECKS=1')
      connection.release()
    }
  }
}

exports.getAppInfo = async function() {
  const schema = 'stig-manager-appinfo-v1.1'
  const sqlAnalyze = `ANALYZE TABLE collection, asset, review, review_history, user`
  const sqlInfoSchema = `
  SELECT
    TABLE_NAME as tableName,
    TABLE_ROWS as tableRows,
    TABLE_COLLATION as tableCollation,
    AVG_ROW_LENGTH as avgRowLength,
    DATA_LENGTH as dataLength,
    INDEX_LENGTH as indexLength,
    AUTO_INCREMENT as autoIncrement,
    CREATE_TIME as createTime,
    UPDATE_TIME as updateTime
  FROM
    information_schema.TABLES
  WHERE
    TABLE_SCHEMA = ?
    and TABLE_TYPE='BASE TABLE'
  ORDER BY
    TABLE_NAME`
  const sqlCollectionAssetStigs = `
  SELECT
    CAST(sub.collectionId as char) as collectionId,
    sum(case when sub.assetId is not null and sub.stigAssetCnt = 0 then 1 else 0 end) as range00,
    sum(case when sub.stigAssetCnt >= 1 and sub.stigAssetCnt <= 5 then 1 else 0 end) as range01to05,
    sum(case when sub.stigAssetCnt >= 6 and sub.stigAssetCnt <= 10 then 1 else 0 end) as range06to10,
    sum(case when sub.stigAssetCnt >= 11 and sub.stigAssetCnt <= 15 then 1 else 0 end) as range11to15,
    sum(case when sub.stigAssetCnt >= 16 then 1 else 0 end) as range16plus
  FROM
  (SELECT
    c.collectionId,
    c.name,
    a.assetId,
    COUNT(sa.assetId) as stigAssetCnt
  FROM
    collection c
    LEFT JOIN asset a on a.collectionId = c.collectionId and a.state = "enabled"
    LEFT JOIN stig_asset_map sa on sa.assetId = a.assetId 
  GROUP BY
    c.collectionId,
    c.name,
    a.assetId) as sub
  GROUP BY
    sub.collectionId
  ORDER BY
    sub.collectionId
  `
  const sqlCountsByCollection = `
  SELECT
    cast(c.collectionId as char) as collectionId,
    c.name,
    c.state,
    c.settings,
	  count(distinct if(a.state = "enabled", a.assetId, null)) as assets,
    count(distinct if(a.state = "disabled", a.assetId, null)) as assetsDisabled,
    count(distinct if(a.state = "enabled", sa.benchmarkId, null)) as uniqueStigs,
    sum(if(a.state = "enabled" and sa.saId, 1, 0)) as stigAssignments,
    sum(if(a.state = "enabled",rev.ruleCount,0)) as rules,
    sum(if(a.state = "enabled", (sa.pass + sa.fail + sa.notapplicable + sa.notchecked + sa.notselected + sa.informational + sa.fixed + sa.unknown + sa.error), 0)) as reviews,
    sum(if(a.state = "disabled", (sa.pass + sa.fail + sa.notapplicable + sa.notchecked + sa.notselected + sa.informational + sa.fixed + sa.unknown + sa.error), 0)) as reviewsDisabled
  FROM
    collection c
    left join asset a on c.collectionId = a.collectionId
    left join stig_asset_map sa on a.assetId = sa.assetId
    left join default_rev dr on c.collectionId = dr.collectionId and sa.benchmarkId = dr.benchmarkId
    left join revision rev on dr.revId = rev.revId
  GROUP BY
    c.collectionId
  ORDER BY
    c.collectionId
  `
  const sqlLabelCountsByCollection = `
  SELECT
    cast(c.collectionId as char) as collectionId,
    count(distinct cl.clId) as collectionLabels,
    count(distinct clam.assetId) as labeledAssets,
    count(distinct clam.claId) as assetLabels
  FROM
    collection c
    left join collection_label cl on cl.collectionId = c.collectionId
    left join collection_label_asset_map clam on clam.clId = cl.clId
    left join asset a on clam.assetId = a.assetId and a.state = "enabled"
  GROUP BY
    c.collectionId
  `  
  const sqlGrantsByCollection = `
  with ctePerGrantee as (
    select
      cg.collectionId, 
      json_object(
        'grantId', cg.grantId,
        'grantee', json_object(
          'userId', cg.userId,
          'userGroupId', cg.userGroupId
        ),
        'ruleCounts', json_object(
          'rw', SUM(CASE WHEN cga.access = 'rw' THEN 1 ELSE 0 END),
          'r', SUM(CASE WHEN cga.access = 'r' THEN 1 ELSE 0 END),
          'none', SUM(CASE WHEN cga.access = 'none' THEN 1 ELSE 0 END)
        ), 
        'uniqueAssets', count(distinct if(a.state = 'enabled', sam.assetId, null)),
        'uniqueAssetsDisabled', count(distinct if(a.state = 'disabled', sam.assetId, null)),
        'uniqueStigs', count(distinct if(a.state = 'enabled', sam.benchmarkId, null)),
        'uniqueStigsDisabled', count(distinct if(a.state = 'disabled', sam.benchmarkId, null)),
        'role', 
          case when cg.roleId = 1 then 'restricted' else 
            case when cg.roleId = 2 then 'full' else
              case when cg.roleId = 3 then 'manage' else
                case when cg.roleId = 4 then 'owner'
                end
              end
            end
          end
      ) as perGrantee
    from 
      collection_grant cg
      left join collection_grant_acl cga ON cg.grantId = cga.grantId
      left join stig_asset_map sam on sam.assetId=cga.assetId and sam.benchmarkId=cga.benchmarkId
      left join asset a on a.assetId = sam.assetId
    group by
      cg.grantId)
    select 
      collectionId, 
      json_arrayagg(perGrantee) as grants
    from 
      ctePerGrantee
    group by 
      collectionId`
  const sqlRoleCountsByCollection = `
  SELECT 
    collectionId,
    SUM(CASE WHEN roleId = 1 THEN 1 ELSE 0 END) AS restricted,
    SUM(CASE WHEN roleId = 2 THEN 1 ELSE 0 END) AS full,
    SUM(CASE WHEN roleId = 3 THEN 1 ELSE 0 END) AS manage,
    SUM(CASE WHEN roleId = 4 THEN 1 ELSE 0 END) AS owner
  FROM 
    collection_grant
  GROUP BY 
    collectionId
  ORDER BY 
    collectionId
  `
  const sqlUserInfo = `
  select 
    ud.userId,
    ud.username,
    ud.created, 
    ud.lastAccess,
    coalesce(
      JSON_EXTRACT(ud.lastClaims, '$.${config.oauth.claims.privileges}'),
      json_array()
    ) as privileges,
    json_object(
		  "restricted", sum(case when cg.roleId = 1 then 1 else 0 end),
      "full", sum(case when cg.roleId = 2 then 1 else 0 end),
		  "manage", sum(case when cg.roleId = 3 then 1 else 0 end),
      "owner", sum(case when cg.roleId = 4 then 1 else 0 end)
	  ) as roles
  from 
    user_data ud
    left join collection_grant cg using (userId)
  group by
	  ud.userId
  `

  const sqlUserGroupInfo = `
  select 
    ug.userGroupId,
    ug.name,
    count(distinct ugum.userId) as members,
    ug.createdDate as created, 
    ug.modifiedDate, 
    json_object(
        "restricted", count(distinct case when cg.roleId = 1 then cg.collectionId else null end),
        "full", count(distinct case when cg.roleId = 2 then cg.collectionId else null end),
        "manage", count(distinct case when cg.roleId = 3 then cg.collectionId else null end),
        "owner", count(distinct case when cg.roleId = 4 then cg.collectionId else null end)
    ) as roles
  from 
    user_group ug
    left join collection_grant cg on cg.userGroupId = ug.userGroupId
	  left join user_group_user_map ugum ON ugum.userGroupId = ug.userGroupId
  group by
	  ug.userGroupId
  `  
  const sqlMySqlVersion = `SELECT VERSION() as version`

  const mySqlVariablesOnly = [
    'innodb_buffer_pool_size',
    'innodb_log_buffer_size',
    'innodb_log_file_size',
    'tmp_table_size',
    'key_buffer_size',
    'max_heap_table_size',
    'temptable_max_mmap',
    'sort_buffer_size',
    'read_buffer_size',
    'read_rnd_buffer_size',
    'join_buffer_size',
    'binlog_cache_size',
    'tmp_table_size',
    'innodb_buffer_pool_instances' ,  
    'innodb_io_capacity' , 
    'innodb_io_capacity_max' ,  
    'innodb_flush_sync' ,  
    'innodb_io_capacity_max' ,  
    'innodb_lock_wait_timeout',
    'version',
    'version_compile_machine',
    'version_compile_os',
    'long_query_time'
  ]
  const sqlMySqlVariablesValues = `
  SELECT 
    variable_name,
    variable_value as value
    FROM 
    performance_schema.global_variables
  WHERE 
    variable_name IN (${mySqlVariablesOnly.map(v => `'${v}'`).join(',')})
    ORDER by variable_name
  `
  const mySqlStatusOnly = [
  'Bytes_received',
  'Bytes_sent',
  'Handler_commit',
  'Handler_update',
  'Handler_write',
  'Innodb_buffer_pool_bytes_data',
  'Innodb_row_lock_waits',
  'Innodb_rows_read',
  'Innodb_rows_updated',
  'Innodb_rows_inserted',
  'Innodb_row_lock_time_avg',
  'Innodb_row_lock_time_max',
  'Created_tmp_files',
  'Created_tmp_tables',
  'Max_used_connections',
  'Open_tables',
  'Opened_tables',
  'Queries',
  'Select_full_join',
  'Slow_queries',
  'Table_locks_immediate',
  'Table_locks_waited',
  'Threads_created',
  'Uptime'
  ]
  const sqlMySqlStatusValues = `
  SELECT 
    variable_name,
    variable_value as value
  FROM 
    performance_schema.global_status
  WHERE 
    variable_name IN (
        ${mySqlStatusOnly.map( v => `'${v}'`).join(',')}
    )
  ORDER by variable_name
  `
  await dbUtils.pool.query(sqlAnalyze)
  const [schemaInfoArray] = await dbUtils.pool.query(sqlInfoSchema, [config.database.schema])
  const tables = createObjectFromKeyValue(schemaInfoArray, "tableName")

  const rowCountQueries = []
  for (const table in tables) {
    rowCountQueries.push(dbUtils.pool.query(`SELECT "${table}" as tableName, count(*) as rowCount from ${table}`))
  }

  let [
    [assetStigByCollection],
    [countsByCollection],
    [labelCountsByCollection],
    [grantsByCollection],
    [roleCountsByCollection],
    [userInfo],
    [userGroupInfo],
    [mySqlVersion],
    [mySqlVariables],
    [mySqlStatus],
    rowCountResults
  ] = await Promise.all([
    dbUtils.pool.query(sqlCollectionAssetStigs),
    dbUtils.pool.query(sqlCountsByCollection),
    dbUtils.pool.query(sqlLabelCountsByCollection),
    dbUtils.pool.query(sqlGrantsByCollection),
    dbUtils.pool.query(sqlRoleCountsByCollection),
    dbUtils.pool.query(sqlUserInfo),
    dbUtils.pool.query(sqlUserGroupInfo),
    dbUtils.pool.query(sqlMySqlVersion),
    dbUtils.pool.query(sqlMySqlVariablesValues),
    dbUtils.pool.query(sqlMySqlStatusValues),
    Promise.all(rowCountQueries)
  ])

  for (const result of rowCountResults) {
    tables[result[0][0].tableName].rowCount = result[0][0].rowCount
  }

  // remove strings from user privileges array that are not meaningful to stigman
  const stigmanPrivs = ['admin', 'create_collection']
  for (const user of userInfo ) {
    user.privileges = user.privileges.filter(v => stigmanPrivs.includes(v))
  }

  //count privilege assignments and break out by lastAccess time periods
  const userPrivilegeCounts = breakOutPrivilegeUsage(userInfo)

  //create working copy of operational stats
  const requests = klona(logger.requestStats)

  requests.operationIds = sortObjectByKeys(requests.operationIds)

  // Create objects keyed by collectionId from arrays of objects
  countsByCollection = createObjectFromKeyValue(countsByCollection, "collectionId")
  labelCountsByCollection = createObjectFromKeyValue(labelCountsByCollection, "collectionId")
  assetStigByCollection = createObjectFromKeyValue(assetStigByCollection, "collectionId")
  grantsByCollection = createObjectFromKeyValue(grantsByCollection, "collectionId")
  roleCountsByCollection = createObjectFromKeyValue(roleCountsByCollection, "collectionId")

  // Bundle "byCollection" stats together by collectionId
  for(const collectionId in countsByCollection) {
    if (assetStigByCollection[collectionId]) {
      countsByCollection[collectionId].assetStigRanges = assetStigByCollection[collectionId]
    }
    if (grantsByCollection[collectionId]) {
      const grants = {}
      
      // For each ACL in the collection's array of ACLs
      for (const grant of grantsByCollection[collectionId].grants) {
          grants[grant.grantId] = grant
          delete grant.grantId
      }
      
      countsByCollection[collectionId].grants = grants
    }
    else {
      countsByCollection[collectionId].grants = {}
    }
    if (roleCountsByCollection[collectionId]) {
      countsByCollection[collectionId].roleCounts = roleCountsByCollection[collectionId]
    }
    else {
      countsByCollection[collectionId].roleCounts = {
        restricted: 0,
        full: 0,
        manage: 0,
        owner: 0
      }
    }    
    if (labelCountsByCollection[collectionId]) {
      countsByCollection[collectionId].labelCounts = labelCountsByCollection[collectionId]
    }
  }

  const returnObj = {
    date: new Date().toISOString(),
    schema,
    version: config.version,
    collections: countsByCollection,
    requests,
    users: {
      userInfo: createObjectFromKeyValue(userInfo, "userId", null),
      userPrivilegeCounts
    },
    groups: createObjectFromKeyValue(userGroupInfo, "userGroupId", null),
    mysql: {
      version: mySqlVersion[0].version,
      tables,
      variables: createObjectFromKeyValue(mySqlVariables, "variable_name", "value"),
      status: createObjectFromKeyValue(mySqlStatus, "variable_name", "value")
    },
    nodejs: getNodeValues()
  }
  return returnObj

  // Reduce an array of objects to a single object, using the value of one property as keys
  // and either assigning the rest of the object or the value of a second property as the value.
  function createObjectFromKeyValue(data, keyPropertyName, valuePropertyName = null, includeKey = false) {
    return data.reduce((acc, item) => {
      const { [keyPropertyName]: key, ...rest } = item
      acc[key] = valuePropertyName ? item[valuePropertyName] : includeKey ? item : rest
      return acc
    }, {})
  }

  function sortObjectByKeys(obj) {
    // Create a new object and add properties in sorted order
    const sortedObj = {}
    for (const key of Object.keys(obj).sort()) {
      sortedObj[key] = obj[key]
    }
    return sortedObj
  }

  function breakOutPrivilegeUsage(userInfo) {
    let privilegeCounts = {
      overall: {none:0},
      activeInLast30Days: {none:0},
      activeInLast90Days: {none:0}
    }
    
    // Calculate the timestamps for 30 and 90 days ago
    const currentTime = Math.floor(Date.now() / 1000)
    const thirtyDaysAgo = currentTime - (30 * 24 * 60 * 60)
    const ninetyDaysAgo = currentTime - (90 * 24 * 60 * 60)
    const updateCounts = (categoryCounts, userPrivs) => {
      if (userPrivs.length === 0) {
        categoryCounts.none++
      }
      for (const privilege of userPrivs) {
        categoryCounts[privilege] = categoryCounts[privilege] ? categoryCounts[privilege] + 1 : 1
      }
    }

    for (const user of userInfo) {
      updateCounts(privilegeCounts.overall, user.privileges)
      // Update counts for the last 30 and 90 days based on lastAccess
      if (user.lastAccess >= ninetyDaysAgo) {
        updateCounts(privilegeCounts.activeInLast90Days, user.privileges)
      }
      if (user.lastAccess >= thirtyDaysAgo) {
        updateCounts(privilegeCounts.activeInLast30Days, user.privileges)
      }
    }
    return privilegeCounts
  }

  function getNodeValues() {
    const {environmentVariables, header, resourceUsage} = process.report.getReport()
    
    const environment = {}
    for (const [key, value] of Object.entries(environmentVariables)) {
      if (/^(NODE|STIGMAN)_/.test(key)) {
        environment[key] = key === 'STIGMAN_DB_PASSWORD' ? '***' : value
      }
    }
    const {platform, arch, nodejsVersion, cpus, osMachine, osName, osRelease} = header
    for (let x = 0; x < cpus.length; x++) {
      cpus[x] = {model: cpus[x].model, speed: cpus[x].speed}
    }
    const loadAverage = os.loadavg().join(', ')

    const memory = process.memoryUsage()
    memory.maxRss = resourceUsage.maxRss
    return {
      version: nodejsVersion.substring(1),
      uptime: process.uptime(),
      os: {
        platform,
        arch,
        osMachine,
        osName,
        osRelease,
        loadAverage
      },
      environment,
      memory,
      cpus
    }
  }
}

