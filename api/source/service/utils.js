const mysql = require('mysql2/promise')
const config = require('../utils/config')
const logger = require('../utils/logger')
const retry = require('async-retry')
const Umzug = require('umzug')
const path = require('path')
const fs = require("fs")
const semverLt = require('semver/functions/lt')
const semverCoerce = require('semver/functions/coerce')
const Importer = require('./migrations/lib/mysql-import.js')
const minMySqlVersion = '8.0.24'
let _this = this
let initAttempt = 0

module.exports.testConnection = async function () {
  logger.writeDebug('mysql', 'preflight', { attempt: ++initAttempt })
  let [result] = await _this.pool.query('SELECT VERSION() as version')
  let [tables] = await _this.pool.query('SHOW TABLES')
  return {
    detectedMySqlVersion: result[0].version,
    detectedTables: tables.length 
  }
}

async function setupInitialDatabase(pool){
  const importer = new Importer(pool)
  const dir = path.join(__dirname, 'migrations', 'sql', 'current')
  const files = await fs.promises.readdir(dir)
  try {
    for (const file of files) {
        logger.writeInfo('mysql', 'initalizing', {status: 'running', name: file })
        await importer.import(path.join(dir, file))
    }    
  }
  catch (e) {
    logger.writeError('mysql', 'initialize', {status: 'error', files: files, message: e.message })
    throw new Error(`Failed to initialize database with file ${e.message}`)
  }
}

function getPoolConfig() {
  const poolConfig = {
    connectionLimit : config.database.maxConnections,
    timezone: 'Z',
    host: config.database.host,
    port: config.database.port,
    user: config.database.username,
    database: config.database.schema,
    decimalNumbers: true,
    charset: 'utf8mb4_0900_ai_ci',
    typeCast: function (field, next) {
      if ((field.type === "BIT") && (field.length === 1)) {
        let bytes = field.buffer() || [0]
        return( bytes[ 0 ] === 1 )
      }
      return next()
    } 
  }
  if (config.database.password) {
    poolConfig.password = config.database.password
  }
  if (config.database.tls.ca_file || config.database.tls.cert_file || config.database.tls.key_file) {
    const sslConfig = {}
    if (config.database.tls.ca_file) {
      sslConfig.ca = fs.readFileSync(path.join(__dirname, '..', 'tls', config.database.tls.ca_file))
    }
    if (config.database.tls.cert_file) {
      sslConfig.cert = fs.readFileSync(path.join(__dirname, '..', 'tls', config.database.tls.cert_file))
    }
    if (config.database.tls.key_file) {
      sslConfig.key = fs.readFileSync(path.join(__dirname, '..', 'tls', config.database.tls.key_file))
    }
    poolConfig.ssl = sslConfig
  }
  return poolConfig
}
/*
* setDepStatus is a function that sets the status of a dependency
*/
module.exports.initializeDatabase = async function (setDepStatus) {
  // Create the connection pool
  const poolConfig = getPoolConfig()
  logger.writeDebug('mysql', 'poolConfig', { ...poolConfig })
  _this.pool = mysql.createPool(poolConfig)
  // Set common session variables
  _this.pool.on('connection', function (connection) {
    connection.query('SET SESSION group_concat_max_len=10000000')
  })

  // Call the pool destruction methods on SIGTERM and SEGINT
  async function closePoolAndExit(signal) {
    logger.writeInfo('app', 'shutdown', { signal })
    try {
      await _this.pool.end()
      logger.writeInfo('mysql', 'close', { success: true })
      process.exit(0)
    } catch(err) {
      logger.writeError('mysql', 'close', { success: false, message: err.message })
      process.exit(1)
    }
  }   
  process.on('SIGPIPE', closePoolAndExit)
  process.on('SIGHUP', closePoolAndExit)
  process.on('SIGTERM', closePoolAndExit)
  process.on('SIGINT', closePoolAndExit)

  // Preflight the pool every 5 seconds
  const {detectedTables,detectedMySqlVersion} = await retry(_this.testConnection, {
    retries: 24,
    factor: 1,
    minTimeout: 5 * 1000,
    maxTimeout: 5 * 1000,
    onRetry: (error) => {
      logger.writeError('mysql', 'preflight', { success: false, message: error.message })
    }
  })
  if (semverLt(semverCoerce(detectedMySqlVersion), minMySqlVersion) ) {
    logger.writeError('mysql', 'preflight', { success: false, message: `MySQL release ${detectedMySqlVersion} is too old. Update to release ${minMySqlVersion} or later.` })
    process.exit(1)
  } 
  else {
    logger.writeInfo('mysql', 'preflight', { 
      success: true,
      version: detectedMySqlVersion
      })
  }

  try {
    if (detectedTables === 0) {
      logger.writeInfo('mysql', 'setup', { message: 'No existing tables detected. Setting up new database.' })
      await setupInitialDatabase(_this.pool)
      logger.writeInfo('mysql', 'setup', { message: 'Database setup complete.' })
    }
    // Perform migrations
    const umzug = new Umzug({
      migrations: {
        path: path.join(__dirname, './migrations'),
        params: [_this.pool]
      },
      storage: path.join(__dirname, './migrations/lib/umzug-mysql-storage'),
      storageOptions: {
        pool: _this.pool
      }
    })

    if (config.database.revert) {
      const migrations = await umzug.executed()
      if (migrations.length) {
        logger.writeInfo('mysql', 'migration', { message: 'MySQL schema will revert the last migration and terminate' })
        await umzug.down()
      } else {
        logger.writeInfo('mysql', 'migration', { message: 'MySQL schema has no migrations to revert' })
      }
      logger.writeInfo('mysql', 'migration', { message: 'MySQL revert migration has completed' })
      process.exit(1)
    }
    const migrations = await umzug.pending()
    if (migrations.length > 0) {
      logger.writeInfo('mysql', 'migration', { message: `MySQL schema requires ${migrations.length} update${migrations.length > 1 ? 's' : ''}` })
      await umzug.up()
      logger.writeInfo('mysql', 'migration', { message: `All migrations performed successfully` })
    }
    else {
      logger.writeInfo('mysql', 'migration', { message: `MySQL schema is up to date` })
    }
    setDepStatus('db', 'up')
    const migrated = await umzug.executed()
    config.lastMigration = parseInt(migrated[migrated.length -1].file.substring(0,4))
  }
  catch (error) {
    logger.writeError('mysql', 'initalization', { message: error.message })
    setDepStatus('db', 'failed')
    throw new Error('Failed during database initialization or migration.')
  } 
}

module.exports.parseRevisionStr = function (revisionStr) {
  const ro = {}
  if (revisionStr !== 'latest') {
    const results = /V(\d+)R(\d+(\.\d+)?)/.exec(revisionStr)
    ro.version = results[1]
    ro.release = results[2]
    ro.table = 'revision'
    ro.table_alias = 'r'
    ro.predicates = ' and r.version = ? and r.release = ? '
  }
  else {
    ro.version = null
    ro.release = null
    ro.table = 'current_rev'
    ro.table_alias = 'cr'
    ro.predicates = ''
  }
  return ro
}

module.exports.selectCollectionByAssetId = async function (assetId) {
  // another possibility: return _this.pool.query(`SELECT c.* from asset a left join collection c using (collectionId) where a.assetId = ?`, [assetId])
  return _this.pool.query(`SELECT * from collection where collectionId = (select collectionId from asset where assetId = ?)`, [assetId])
}

module.exports.getGrantByAssetId = async function (assetId, grants) {
  const [rows] = await _this.selectCollectionByAssetId(assetId)
  return rows.length ? grants[rows[0].collectionId] : null
}

module.exports.getUserAssetStigAccess = async function ({assetId, benchmarkId, grants}) {
  const grant = await _this.getGrantByAssetId(assetId, grants)
  if (!grant) return 'none'
  const binds = [assetId, benchmarkId]
  const sql = `with ${_this.cteAclEffective({grantIds: grant.grantIds})} select
    coalesce(ae.access, 'rw') as access
  from
	  stig_asset_map sa
    ${grant.roleId === 1 ? 'inner' : 'left'} join cteAclEffective ae using (saId)
  where
	  sa.assetId = ? and sa.benchmarkId = ?`
    const [rows] = await _this.pool.query(sql, binds)
    return rows[0]?.access ?? 'none'
}

/**
 * updateStatsAssetStig
 * @param {PoolConnection} connection 
 * @param {Object} param1 
 * @param {string} param1.collectionId
 * @param {string} param1.assetId
 * @param {string} param1.benchmarkId
 * @param {string[]} param1.rules
 */
module.exports.updateStatsAssetStig = async function(connection, { 
  collectionId,
  collectionIds,
  assetId,
  assetIds,
  assetBenchmarkIds,
  benchmarkId,
  benchmarkIds,
  rules,
  saIds }) {
  if (!connection) { throw new Error ('Connection required')}
  // Handle optional predicates, 
  let predicates = ['sa.assetId IS NOT NULL AND sa.benchmarkId IS NOT NULL']
  let binds = []
  let whereClause = ''

  if (rules && rules.length > 0) {
    predicates.push(`sa.benchmarkId IN (SELECT DISTINCT benchmarkId from rev_group_rule_map left join revision using (revId) where ruleId IN ?)`)
    binds.push( [rules] )
  }

  if (collectionId) {
    predicates.push('a.collectionId = ?')
    binds.push(collectionId)
  }
  if (collectionIds) {
    predicates.push('a.collectionId IN ?')
    binds.push([collectionIds])
  }
  if (assetId) {
    predicates.push('a.assetId = ?')
    binds.push(assetId)
  }
  if (assetIds) {
    predicates.push('a.assetId IN ?')
    binds.push([assetIds])
  }
  if (assetBenchmarkIds) {
    predicates.push(`a.assetId IN (select assetId from stig_asset_map where benchmarkId in ?)`)
    binds.push([assetBenchmarkIds])
  }
  if (benchmarkId) {
    predicates.push('sa.benchmarkId = ?')
    binds.push(benchmarkId)
  }
  if (benchmarkIds) {
    predicates.push('sa.benchmarkId IN ?')
    binds.push([benchmarkIds])
  }
  if (saIds) {
    predicates.push('sa.saId IN ?')
    binds.push([saIds])
  }
  if (predicates.length > 0) {
    whereClause = `where  ${predicates.join(' and ')}`
  }

  const sqlUpdate = `
  with source as
    ( select
       sa.assetId,
       sa.benchmarkId,
       min(review.ts) as minTs,
       max(review.ts) as maxTs,  
       max(review.touchTs) as maxTouchTs,  
       
       sum(CASE WHEN review.statusId = 0 THEN 1 ELSE 0 END) as saved,
       sum(CASE WHEN review.resultEngine is not null and review.statusId = 0 THEN 1 ELSE 0 END) as savedResultEngine,
       sum(CASE WHEN review.statusId = 1 THEN 1 ELSE 0 END) as submitted,
       sum(CASE WHEN review.resultEngine is not null and review.statusId = 1 THEN 1 ELSE 0 END) as submittedResultEngine,
       sum(CASE WHEN review.statusId = 2 THEN 1 ELSE 0 END) as rejected,
       sum(CASE WHEN review.resultEngine is not null and review.statusId = 2 THEN 1 ELSE 0 END) as rejectedResultEngine,
       sum(CASE WHEN review.statusId = 3 THEN 1 ELSE 0 END) as accepted,
       sum(CASE WHEN review.resultEngine is not null and review.statusId = 3 THEN 1 ELSE 0 END) as acceptedResultEngine,

       sum(CASE WHEN review.resultId=4 and rgr.severity='high' THEN 1 ELSE 0 END) as highCount,
       sum(CASE WHEN review.resultId=4 and rgr.severity='medium' THEN 1 ELSE 0 END) as mediumCount,
       sum(CASE WHEN review.resultId=4 and rgr.severity='low' THEN 1 ELSE 0 END) as lowCount,
       
       sum(CASE WHEN review.resultId = 1 THEN 1 ELSE 0 END) as notchecked,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 1 THEN 1 ELSE 0 END) as notcheckedResultEngine,
       sum(CASE WHEN review.resultId = 2 THEN 1 ELSE 0 END) as notapplicable,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 2 THEN 1 ELSE 0 END) as notapplicableResultEngine,
       sum(CASE WHEN review.resultId = 3 THEN 1 ELSE 0 END) as pass,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 3 THEN 1 ELSE 0 END) as passResultEngine,
       sum(CASE WHEN review.resultId = 4 THEN 1 ELSE 0 END) as fail,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 4 THEN 1 ELSE 0 END) as failResultEngine,
       sum(CASE WHEN review.resultId = 5 THEN 1 ELSE 0 END) as unknown,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 5 THEN 1 ELSE 0 END) as unknownResultEngine,
       sum(CASE WHEN review.resultId = 6 THEN 1 ELSE 0 END) as error,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 6 THEN 1 ELSE 0 END) as errorResultEngine,
       sum(CASE WHEN review.resultId = 7 THEN 1 ELSE 0 END) as notselected,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 7 THEN 1 ELSE 0 END) as notselectedResultEngine,            
       sum(CASE WHEN review.resultId = 8 THEN 1 ELSE 0 END) as informational,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 8 THEN 1 ELSE 0 END) as informationalResultEngine,
       sum(CASE WHEN review.resultId = 9 THEN 1 ELSE 0 END) as fixed,
       sum(CASE WHEN review.resultEngine is not null and review.resultId = 9 THEN 1 ELSE 0 END) as fixedResultEngine
       
       from
         asset a
         left join stig_asset_map sa using (assetId)
         left join default_rev dr on (sa.benchmarkId = dr.benchmarkId and a.collectionId = dr.collectionId)
         left join rev_group_rule_map rgr on dr.revId = rgr.revId
         left join rule_version_check_digest rvcd on rgr.ruleId = rvcd.ruleId
         left join review on (rvcd.version=review.version and rvcd.checkDigest=review.checkDigest and review.assetId=sa.assetId)
    ${whereClause}
    group by
      sa.assetId,
      sa.benchmarkId
      )
  update stig_asset_map sam
    inner join source on sam.assetId = source.assetId and source.benchmarkId = sam.benchmarkId
    set sam.minTs = source.minTs,
        sam.maxTs = source.maxTs,
        sam.maxTouchTs = source.maxTouchTs,
        sam.saved = source.saved,
        sam.savedResultEngine = source.savedResultEngine,
        sam.submitted = source.submitted,
        sam.submittedResultEngine = source.submittedResultEngine,
        sam.rejected = source.rejected,
        sam.rejectedResultEngine = source.rejectedResultEngine,
        sam.accepted = source.accepted,
        sam.acceptedResultEngine = source.acceptedResultEngine,
        sam.highCount = source.highCount,
        sam.mediumCount = source.mediumCount,
        sam.lowCount = source.lowCount,
        sam.notchecked = source.notchecked,
        sam.notcheckedResultEngine = source.notcheckedResultEngine,
        sam.notapplicable = source.notapplicable,
        sam.notapplicableResultEngine = source.notapplicableResultEngine,
        sam.pass = source.pass,
        sam.passResultEngine = source.passResultEngine,
        sam.fail = source.fail,
        sam.failResultEngine = source.failResultEngine,
        sam.unknown = source.unknown,
        sam.unknownResultEngine = source.unknownResultEngine,
        sam.error = source.error,
        sam.errorResultEngine = source.errorResultEngine,
        sam.notselected = source.notselected,
        sam.notselectedResultEngine = source.notselectedResultEngine,
        sam.informational = source.informational,
        sam.informationalResultEngine = source.informationalResultEngine,
        sam.fixed = source.fixed,
        sam.fixedResultEngine = source.fixedResultEngine        
    `

    let stats
    [stats] = await connection.query(sqlUpdate, binds)
    return stats

}

module.exports.uuidToSqlString  = function (uuid) {
  return {
    toSqlString: function () {
      return `UUID_TO_BIN(${mysql.escape(uuid)},1)`
    }
  }
}

module.exports.makeQueryString = function ({ctes = [], hints= [], columns, joins, predicates, groupBy, orderBy, format = false}) {
  if (joins instanceof Set) joins = Array.from(joins)
  if (groupBy instanceof Set) groupBy = Array.from(groupBy)
  const query = `${ctes.length ? 'WITH ' + ctes.join(',  \n') : ''}
SELECT ${hints.length ? '/*+ ' + hints.join(' ') + '*/' : ''}
  ${columns.join(',\n  ')}
FROM
  ${joins.join('\n  ')}
${predicates?.statements.length ? 'WHERE\n  ' + predicates.statements.join(' and\n  ') : ''}
${groupBy?.length ? 'GROUP BY\n  ' + groupBy.join(',\n  ') : ''}
${orderBy?.length ? 'ORDER BY\n  ' + orderBy.join(',\n  ') : ''}
`
  return format? mysql.format(query, predicates.binds) : query
}

module.exports.CONTEXT_ALL = 'all'
module.exports.CONTEXT_DEPT = 'department'
module.exports.CONTEXT_USER = 'user'
module.exports.REVIEW_RESULT_API = { 
  'notchecked': 1,
  'notapplicable': 2,
  'pass': 3,
  'fail': 4,
  'unknown': 5,
  'error': 6,
  'notselected': 7,
  'informational': 8,
  'fixed': 9
}
module.exports.REVIEW_ACTION_API = { 
  'remediate': 1,
  'mitigate': 2,
  'exception': 3
}
module.exports.REVIEW_STATUS_API = { 
  'saved': 0,
  'submitted': 1,
  'rejected': 2,
  'accepted': 3
}
module.exports.WRITE_ACTION = { 
  CREATE: 0,
  REPLACE: 1,
  UPDATE: 2
}

module.exports.retryOnDeadlock = async function (fn, statusObj = {}) {
  const retryFunction = async function (bail) {
    try {
      return await fn()
    }
    catch (e) {
      if (e.code === 'ER_LOCK_DEADLOCK') {
        throw(e)
      }
      bail(e)
    }
  }
  statusObj.retries = 0
  return await retry(retryFunction, {
    retries: 15,
    factor: 1,
    minTimeout: 200,
    maxTimeout: 200,
    onRetry: () => {
      ++statusObj.retries
    }
  })
}

module.exports.retryOnDeadlock2 = async function ({ transactionFn, statusObj = {}, beforeReleaseFn, afterRollbackFn}) {
  const connection = await _this.pool.getConnection()
  const retryFunction = async function (bail) {
    try {
      await connection.query('START TRANSACTION')
      const transactionReturn = await transactionFn(connection)
      await connection.commit()
      await connection.release()
      return transactionReturn
    }
    catch (e) {
      if (e.code === 'ER_LOCK_DEADLOCK') {
        throw(e)
      }
      await connection.rollback()
      afterRollbackFn?.(connection)
      beforeReleaseFn?.(connection)
      await connection.release()
      bail(e)
    }
  }
  statusObj.retries = 0
  return  await retry(retryFunction, {
    retries: 15,
    factor: 1,
    minTimeout: 200,
    maxTimeout: 200,
    onRetry: () => {
      ++statusObj.retries
    }
  })
  // return returnValue

}

module.exports.pruneCollectionRevMap = async function (connection) {
  const sql = `delete crm from collection_rev_map crm
  left join( select distinct a.collectionId, sa.benchmarkId from stig_asset_map sa left join asset a using (assetId) where a.state = "enabled" ) maps using (collectionId, benchmarkId)
  where maps.collectionId is null`
  await (connection ?? _this.pool).query(sql)
}

module.exports.updateDefaultRev = async function (connection, {collectionId, collectionIds, benchmarkId}) {
  const predicates = []
  const binds = []
  let whereClause = ''
  if (collectionId) {
    predicates.push(`collectionId = ?`)
    binds.push(collectionId)
  }
  if (collectionIds) {
    predicates.push(`collectionId IN ?`)
    binds.push([collectionIds])
  }
  if (benchmarkId) {
    predicates.push(`benchmarkId = ?`)
    binds.push(benchmarkId)
  }
  if (predicates.length > 0) {
    whereClause = `where  ${predicates.join(' and ')}`
  }
  const sqlDelete = `DELETE FROM default_rev ${whereClause}`
  const sqlInsert = `INSERT INTO default_rev(collectionId, benchmarkId, revId, revisionPinned) SELECT collectionId, benchmarkId, revId, revisionPinned FROM v_default_rev ${whereClause}`
  await (connection ?? _this.pool).query(sqlDelete, binds)
  await (connection ?? _this.pool).query(sqlInsert, binds)
  
}

module.exports.jsonArrayAggDistinct = function (valueStr) {
  return `cast(concat('[', group_concat(distinct ${valueStr}), ']') as json)`
}

module.exports.jsonArrayAgg = function ({value, orderBy = '', distinct = false}) {
  return `cast(concat('[', group_concat(${distinct ? 'distinct ' : ''}${value} ${orderBy ? `order by ${orderBy}` : ''}), ']') as json)`
}

module.exports.sqlGrantees = function ({collectionId, collectionIds, userId, username, nameMatch, includeColumnCollectionId = true, returnCte = false}) {
  const predicates = {
    statements: [],
    binds: []
  }
  if (collectionId) {
    predicates.statements.push('cg.collectionId = ?')
    predicates.binds.push(collectionId)
  }
  if (collectionIds) {
    predicates.statements.push('cg.collectionId IN (?)')
    predicates.binds.push(collectionIds)
  }
  if (userId) {
    predicates.statements.push('ud.userId = ?')
    predicates.binds.push(userId)
  }
  if (username) {
    let matchStr = '= ?'
    if ( nameMatch && nameMatch !== 'exact') {
      matchStr = 'LIKE ?'
      switch (nameMatch) {
        case 'startsWith':
          username = `${username}%`
          break
        case 'endsWith':
          username = `%${username}`
          break
        case 'contains':
          username = `%${username}%`
          break
      }
    }
    predicates.statements.push(`ud.username ${matchStr}`)
    predicates.binds.push(username)
  }

  // final query will be a UNION of sqlDirectGrants and sqlGroupGrants
  const sqlDirectGrants = `select 
  ${includeColumnCollectionId ? 'cg.collectionId,' : ''}
  cast(cg.userId as char) as userId,
  cg.roleId,
  json_array(json_object('userId', cast(ud.userId as char),'username', ud.username)) as grantees,
  json_array(cg.grantId) as grantIds
from
  collection_grant cg
  inner join collection c on (cg.collectionId = c.collectionId and c.state = 'enabled')
  left join user_data ud on cg.userId = ud.userId
where
    cg.userId is not null
    ${predicates.statements.length ? `and ${predicates.statements.join(' and ')}` : ''}`
  const sqlFormattedDirectGrants = mysql.format(sqlDirectGrants, predicates.binds)

  const sqlGroupGrants = `select
  ${includeColumnCollectionId ? 'collectionId,' : ''}
  userId,
  roleId,
  grantees,
  grantIds
from
  (select
    ROW_NUMBER() OVER(PARTITION BY ugu.userId, cg.collectionId ORDER BY cg.roleId desc) as rn,
    ${includeColumnCollectionId ? 'cg.collectionId,' : ''} 
    cast(ugu.userId as char) as userId, 
    cg.roleId,
    json_arrayagg(json_object('userGroupId', cast(cg.userGroupId as char),'name', ug.name)) OVER (PARTITION BY ugu.userId, cg.collectionId, cg.roleId) as grantees,
    json_arrayagg(cg.grantId) OVER (PARTITION BY ugu.userId, cg.collectionId, cg.roleId) as grantIds
from 
    collection_grant cg
    inner join collection c on (cg.collectionId = c.collectionId and c.state = 'enabled')
    left join user_group_user_map ugu on cg.userGroupId = ugu.userGroupId
    left join user_group ug on ugu.userGroupId = ug.userGroupId
    left join user_data ud on ugu.userId = ud.userId
    left join collection_grant cgDirect on (cg.collectionId = cgDirect.collectionId and ugu.userId = cgDirect.userId)
  where
    cg.userGroupId is not null
    and cgDirect.userId is null
    ${predicates.statements.length ? `and ${predicates.statements.join(' and ')}` : ''}
  ) dt
where
  dt.rn = 1`
  const sqlFormattedGroupGrants = mysql.format(sqlGroupGrants, predicates.binds)

  const sqlFormatted = `${sqlFormattedDirectGrants} union ${sqlFormattedGroupGrants}`
  return returnCte ? `cteGrantees as (${sqlFormatted})` : sqlFormatted
}

module.exports.cteAclEffective = function ({grantIds = [], includeColumnCollectionId = true, inClauseTable = 'cteGrantees', inClauseColumn = 'grantIds', inClauseUserId = ''}) {
  const inClause = grantIds.length ? '?' : `select jt.grantId from ${inClauseTable} left join json_table (${inClauseTable}.${inClauseColumn}, '$[*]' COLUMNS (grantId INT PATH '$')) jt on true${inClauseUserId ? ` where ${inClauseTable}.userId = ${inClauseUserId}` : ''}`
  const sql = `cteAclRules as (select${includeColumnCollectionId ? ' a.collectionId,' : ''}
	sa.saId,
	cga.access,
	case when cga.benchmarkId is not null then 1 else 0 end +
	  case when cga.assetId is not null then 1 else 0 end +
	  case when cga.assetId is not null and cga.benchmarkId is not null then 1 else 0 end +
	  case when cga.clId is not null then 1 else 0 end as specificity
from
	collection_grant_acl cga
  left join collection_grant cg on cga.grantId = cg.grantId
	left join collection_label_asset_map cla on cga.clId = cla.clId
  left join collection_label cl on cla.clId = cl.clId
	inner join stig_asset_map sa on (
	  case when cga.assetId is not null 
		then cga.assetId = sa.assetId 
		else true
	  end and 
	  case when cga.benchmarkId is not null 
		then cga.benchmarkId = sa.benchmarkId
		else true
	  end and
	  case when cga.clId is not null 
		then cla.assetId = sa.assetId
		else true
	  end)
	inner join asset a on sa.assetId = a.assetId and a.state = 'enabled' and cg.collectionId = a.collectionId
where
	cga.grantId in (${inClause})
),
cteAclRulesRanked as (
    select /*+ NO_MERGE() */ ${includeColumnCollectionId ? ' collectionId,' : ''}
		saId,
    access,
		row_number() over (partition by saId order by specificity desc, access asc) as rn
	from 
		cteAclRules),
cteAclEffective as (select${includeColumnCollectionId ? ' collectionId,' : ''} saId, access from cteAclRulesRanked where rn = 1 and access != 'none')`

  const sqlFormatted = mysql.format(sql, [grantIds])
  return sqlFormatted
}
