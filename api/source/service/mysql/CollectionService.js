'use strict';
const dbUtils = require('./utils')
const config = require('../../utils/config.js')
const Security = require('../../utils/accessLevels')

const _this = this

/**
Generalized queries for collection(s).
**/
exports.queryCollections = async function (inProjection = [], inPredicates = {}, elevate = false, userObject) { 
    let context
    if (userObject.privileges.globalAccess || elevate) {
      context = dbUtils.CONTEXT_ALL
    } else {
      context = dbUtils.CONTEXT_USER
    }

    let columns = [
      'CAST(c.collectionId as char) as collectionId',
      'c.name',
      'c.description',
      'c.workflow',
      'c.metadata'
    ]
    let joins = [
      'collection c',
      'left join collection_grant cg on c.collectionId = cg.collectionId',
      'left join asset a on c.collectionId = a.collectionId',
      'left join stig_asset_map sa on a.assetId = sa.assetId'
    ]

    // PROJECTIONS
    if (inProjection.includes('assets')) {
      columns.push(`cast(
        concat('[', 
          coalesce (
            group_concat(distinct 
              case when a.assetId is not null then 
                json_object(
                  'assetId', CAST(a.assetId as char), 
                  'name', a.name
                )
              else null end 
            order by a.name),
            ''),
        ']')
      as json) as "assets"`)
    }
    if (inProjection.includes('stigs')) {
      joins.push('left join current_rev cr on sa.benchmarkId=cr.benchmarkId')
      joins.push('left join stig st on cr.benchmarkId=st.benchmarkId')
      columns.push(`cast(
        concat('[', 
          coalesce (
            group_concat(distinct 
              case when cr.benchmarkId is not null then 
                json_object(
                  'benchmarkId', cr.benchmarkId, 
                  'lastRevisionStr', concat('V', cr.version, 'R', cr.release), 
                  'lastRevisionDate', date_format(cr.benchmarkDateSql,'%Y-%m-%d'),
                  'title', st.title,
                  'ruleCount', cr.ruleCount)
              else null end 
            order by cr.benchmarkId),
            ''),
        ']')
      as json) as "stigs"`)
    }
    if (inProjection.includes('grants')) {
      columns.push(`(select
        coalesce(
          (select json_arrayagg(
            json_object(
              'user', json_object(
                'userId', CAST(user_data.userId as char),
                'username', user_data.username
                ),
              'accessLevel', accessLevel
            )
          )
          from collection_grant left join user_data using (userId) where collectionId = c.collectionId)
        ,  json_array()
        )
      ) as "grants"`)
    }
    if (inProjection.includes('owners')) {
      columns.push(`(select
        coalesce(
          (select json_arrayagg(
            json_object(
              'userId', CAST(user_data.userId as char),
              'username', user_data.username,
              'email', JSON_VALUE(user_data.lastClaims, "$.${config.oauth.claims.email}"), 
              'displayName', JSON_VALUE(user_data.lastClaims, "$.${config.oauth.claims.name}")
            )
          )
          from collection_grant 
            left join user_data using (userId)
          where collectionId = c.collectionId and accessLevel = 4)
        ,  json_array()
        )
      ) as "owners"`)
    }

    if (inProjection.includes('statistics')) {
      if (context == dbUtils.CONTEXT_USER) {
        joins.push('left join collection_grant cgstat on c.collectionId = cgstat.collectionId')
        columns.push(`(select
          json_object(
            'created', DATE_FORMAT(c.created, '%Y-%m-%dT%TZ'),
            'grantCount', CASE WHEN cg.accessLevel = 1 THEN 1 ELSE COUNT( distinct cgstat.cgId ) END,
            'assetCount', COUNT( distinct a.assetId ),
            'checklistCount', COUNT( distinct sa.saId )
          )
        ) as "statistics"`)
      }
      else {
        columns.push(`(select
          json_object(
            'created', DATE_FORMAT(c.created, '%Y-%m-%dT%TZ'),
            'grantCount', COUNT( distinct cg.cgId ),
            'assetCount', COUNT( distinct a.assetId ),
            'checklistCount', COUNT( distinct sa.saId )
          )
        ) as "statistics"`)
      }
    }

    // PREDICATES
    let predicates = {
      statements: [],
      binds: []
    }
    if ( inPredicates.collectionId ) {
      predicates.statements.push('c.collectionId = ?')
      predicates.binds.push( inPredicates.collectionId )
    }
    if ( inPredicates.name ) {
      let matchStr = '= ?'
      if ( inPredicates.nameMatch && inPredicates.nameMatch !== 'exact') {
        matchStr = 'LIKE ?'
        switch (inPredicates.nameMatch) {
          case 'startsWith':
            inPredicates.name = `${inPredicates.name}%`
            break
          case 'endsWith':
            inPredicates.name = `%${inPredicates.name}`
            break
          case 'contains':
            inPredicates.name = `%${inPredicates.name}%`
            break
        }
      }
      predicates.statements.push(`c.name ${matchStr}`)
      predicates.binds.push( inPredicates.name )
    }
    if ( inPredicates.workflow ) {
      predicates.statements.push('c.workflow = ?')
      predicates.binds.push( inPredicates.workflow )
    }
    if ( inPredicates.metadata ) {
      for (const pair of inPredicates.metadata) {
        const [key, value] = pair.split(':')
        predicates.statements.push('JSON_CONTAINS(c.metadata, ?, ?)')
        predicates.binds.push( `"${value}"`,  `$.${key}`)
      }
    }
    if (context == dbUtils.CONTEXT_USER) {
      joins.push('left join user_stig_asset_map usa on sa.saId = usa.saId')
      predicates.statements.push('(cg.userId = ? AND CASE WHEN cg.accessLevel = 1 THEN usa.userId = cg.userId ELSE TRUE END)')
      predicates.binds.push( userObject.userId, userObject.userId )
    }

    // CONSTRUCT MAIN QUERY
    let sql = 'SELECT '
    sql+= columns.join(",\n")
    sql += ' FROM '
    sql+= joins.join(" \n")
    if (predicates.statements.length > 0) {
      sql += "\nWHERE " + predicates.statements.join(" and ")
    }
    sql += ' group by c.collectionId, c.name, c.description, c.workflow, c.metadata'
    sql += ' order by c.name'
    
    let [rows] = await dbUtils.pool.query(sql, predicates.binds)
    return (rows)
}

exports.queryFindings = async function (aggregator, inProjection = [], inPredicates = {}, userObject) {
  let context
  if (userObject.privileges.globalAccess) {
    context = dbUtils.CONTEXT_ALL
  } else {
    context = dbUtils.CONTEXT_USER
  }

  let columns, groupBy, orderBy
  switch (aggregator) {
    case 'ruleId':
      columns = [
        'ru.ruleId',
        'ru.title',
        'ru.severity',
        'count(distinct a.assetId) as assetCount'
      ]
      groupBy = [
        'ru.ruleId',
        'ru.title',
        'ru.severity'
      ]
      orderBy = 'ru.ruleId'
      break
    case 'groupId':
      columns = [
        'g.groupId',
        'g.title',
        'g.severity',
        'count(distinct a.assetId) as assetCount'
      ]
      groupBy = [
        'g.groupId',
        'g.title',
        'g.severity'
      ]
      orderBy = 'substring(g.groupId from 3) + 0'
      break
    case 'cci':
      columns = [
        'cci.cci',
        'cci.definition',
        'cci.apAcronym',
        'count(distinct a.assetId) as assetCount'
      ]
      groupBy = [
        'cci.cci',
        'cci.definition',
        'cci.apAcronym'
      ]
      orderBy = 'cci.cci'
      break
  }
  let joins = [
    'collection c',
    'left join collection_grant cg on c.collectionId = cg.collectionId',
    'left join asset a on c.collectionId = a.collectionId',
    'inner join stig_asset_map sa on a.assetId = sa.assetId',
    'left join user_stig_asset_map usa on sa.saId = usa.saId',
    'inner join current_group_rule cgr on sa.benchmarkId = cgr.benchmarkId',
    'inner join current_rev cr on sa.benchmarkId = cr.benchmarkId',
    'inner join review rv on (cgr.ruleId = rv.ruleId and a.assetId = rv.assetId and rv.resultId = 4)',
    'inner join `group` g on cgr.groupId = g.groupId',
    'inner join rule ru on rv.ruleId = ru.ruleId',
    'left join rule_cci_map rulecci on ru.ruleId = rulecci.ruleId',
    'left join cci on rulecci.cci = cci.cci'
  ]

  // PROJECTIONS
  
  // Not exposed in API, used internally
  if (inProjection.includes('rulesWithDiscussion')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'ruleId', ru.ruleId,
      'title', ru.title,
      'severity', ru.severity,
      'vulnDiscussion', ru.vulnDiscussion) order by ru.ruleId), ']') as json) as "rules"`)
  }
  // Not exposed in API, used internally
  if (inProjection.includes('stigsInfo')) {
    columns.push(`cast( concat( '[', group_concat(distinct json_object (
      'benchmarkId', cr.benchmarkId,
      'version', cr.version,
      'release', cr.release,
      'benchmarkDate', cr.benchmarkDate) order by cr.benchmarkId), ']') as json) as "stigsInfo"`)
  }
  if (inProjection.includes('rules')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'ruleId', ru.ruleId,
      'title', ru.title,
      'severity', ru.severity) order by ru.ruleId), ']') as json) as "rules"`)
  }
  if (inProjection.includes('groups')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'groupId', g.groupId,
      'title', g.title,
      'severity', g.severity) order by g.groupId), ']') as json) as "groups"`)
  }
  if (inProjection.includes('assets')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'assetId', CAST(a.assetId as char),
      'name', a.name) order by a.name), ']') as json) as "assets"`)
  }
  if (inProjection.includes('stigs')) {
    columns.push(`cast( concat( '[', group_concat(distinct concat('"',cgr.benchmarkId,'"')), ']' ) as json ) as "stigs"`)
  }
  if (inProjection.includes('ccis')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'cci', rulecci.cci,
      'definition', cci.definition,
      'apAcronym', cci.apAcronym) order by rulecci.cci), ']') as json) as "ccis"`)
  }


  // PREDICATES
  let predicates = {
    statements: [],
    binds: []
  }
  
  // collectionId predicate is mandatory per API spec
  if ( inPredicates.collectionId ) {
    predicates.statements.push('c.collectionId = ?')
    predicates.binds.push( inPredicates.collectionId )
  }
  if ( inPredicates.assetId ) {
    predicates.statements.push('a.assetId = ?')
    predicates.binds.push( inPredicates.assetId )
  }
  if ( inPredicates.acceptedOnly ) {
    predicates.statements.push('rv.statusId = ?')
    predicates.binds.push( 3 )
  }
  if ( inPredicates.benchmarkId ) {
    predicates.statements.push('cgr.benchmarkId = ?')
    predicates.binds.push( inPredicates.benchmarkId )
  }
  if (context == dbUtils.CONTEXT_USER) {
    predicates.statements.push('(cg.userId = ? AND CASE WHEN cg.accessLevel = 1 THEN usa.userId = cg.userId ELSE TRUE END)')
    predicates.binds.push( userObject.userId, userObject.userId )
  }
  // CONSTRUCT MAIN QUERY
  let sql = 'SELECT '
  sql+= columns.join(",\n")
  sql += '\nFROM '
  sql+= joins.join(" \n")
  if (predicates.statements.length > 0) {
    sql += "\nWHERE " + predicates.statements.join(" and ")
  }
  sql += '\ngroup by ' + groupBy.join(',')
  sql += '\norder by ' + orderBy
  
  let [rows] = await dbUtils.pool.query(sql, predicates.binds)
  return (rows)
}

exports.queryStatus = async function (inPredicates = {}, userObject) {
  try {
    let context
    if (userObject.privileges.globalAccess) {
      context = dbUtils.CONTEXT_ALL
    } else {
      context = dbUtils.CONTEXT_USER
    }

    let columns = [
      `distinct cast(a.assetId as char) as assetId`,
      'a.name as assetName',
      'sas.benchmarkId',
      `json_object(
        'total', cr.ruleCount,
        'auto', cr.ovalCount
      ) as rules`,
      'sas.minTs',
      'sas.maxTs',
      `json_object(
        'low', sas.lowCount,
          'medium', sas.mediumCount,
          'high', sas.highCount
      ) as findings`,
     `json_object(
        'saved', json_object(
          'total', sas.savedManual + sas.savedAuto,
              'auto', sas.savedAuto),
        'submitted', json_object(
           'total', sas.submittedManual + sas.submittedAuto,
              'auto', sas.submittedAuto),
        'rejected', json_object(
           'total', sas.rejectedManual + sas.rejectedAuto,
              'auto', sas.rejectedAuto),
        'accepted', json_object(
           'total', sas.acceptedManual + sas.acceptedAuto,
              'auto', sas.acceptedAuto)
      ) as status`           
    ]
    let joins = [
      'collection c',
      'left join collection_grant cg on c.collectionId = cg.collectionId',
      'left join asset a on c.collectionId = a.collectionId',
      'inner join stig_asset_map sa on a.assetId = sa.assetId',
      'left join user_stig_asset_map usa on sa.saId = usa.saId',
      'inner join stats_asset_stig sas on (sa.assetId = sas.assetId and sa.benchmarkId = sas.benchmarkId)',
      'left join current_rev cr on sas.benchmarkId = cr.benchmarkId',
    ]

    // PROJECTIONS

    // PREDICATES
    let predicates = {
      statements: [],
      binds: []
    }
    
    // collectionId predicate is mandatory per API spec
    if ( inPredicates.collectionId ) {
      predicates.statements.push('c.collectionId = ?')
      predicates.binds.push( inPredicates.collectionId )
    }
    if ( inPredicates.benchmarkId ) {
      predicates.statements.push('sa.benchmarkId = ?')
      predicates.binds.push( inPredicates.benchmarkId )
    }
    if ( inPredicates.assetId ) {
      predicates.statements.push('sa.assetId = ?')
      predicates.binds.push( inPredicates.assetId )
    }
    if (context == dbUtils.CONTEXT_USER) {
      predicates.statements.push('(cg.userId = ? AND CASE WHEN cg.accessLevel = 1 THEN usa.userId = cg.userId ELSE TRUE END)')
      predicates.binds.push( userObject.userId, userObject.userId )
    }
    // CONSTRUCT MAIN QUERY
    let sql = 'SELECT '
    sql+= columns.join(",\n")
    sql += '\nFROM '
    sql+= joins.join(" \n")
    if (predicates.statements.length > 0) {
      sql += "\nWHERE " + predicates.statements.join(" and ")
    }
    sql += '\norder by a.name, sas.benchmarkId'
    
    let [rows] = await dbUtils.pool.query(sql, predicates.binds)
    return (rows)
  }
  // catch (err) {
  //   throw err
  // }
  finally{}
}

exports.queryStigAssets = async function (inProjection = [], inPredicates = {}, userObject) {
  try {
    let columns = [
      'sa.benchmarkId',
      `json_object(
        'assetId', CAST(a.assetId as char),
        'name', a.name
      ) as asset`
    ]
    let joins = [
      'collection c',
      'left join asset a on c.collectionId = a.collectionId',
      'left join stig_asset_map sa on a.assetId = sa.assetId',
    ]
    // PREDICATES
    let predicates = {
      statements: [],
      binds: []
    }
    if ( inPredicates.collectionId ) {
      predicates.statements.push('c.collectionId = ?')
      predicates.binds.push( inPredicates.collectionId )
    } else {
      throw ( {status: 400, message: 'Missing required predicate: collectionId'} )
    }
    if ( inPredicates.userId ) {
      joins.push('left join user_stig_asset_map usa on sa.saId = usa.saId')
      predicates.statements.push('usa.userId = ?')
      predicates.binds.push( inPredicates.userId )
    }

    // CONSTRUCT MAIN QUERY
    let sql = 'SELECT '
    sql+= columns.join(",\n")
    sql += ' FROM '
    sql+= joins.join(" \n")
    if (predicates.statements.length > 0) {
      sql += "\nWHERE " + predicates.statements.join(" and ")
    }
    sql += ' order by sa.benchmarkId, a.name'
    
    let [rows] = await dbUtils.pool.query(sql, predicates.binds)
    return (rows)

  }
  // catch (err) {
  //   throw err
  // }
  finally{}
}

exports.updateOrReplaceUserStigAssets = async function(writeAction, collectionId, userId, stigAssets, projection, userObject) {
  let connection // available to try, catch, and finally blocks
  try {
    // Connect to MySQL
    connection = await dbUtils.pool.getConnection()
    connection.config.namedPlaceholders = true
    await connection.query('START TRANSACTION');
    if (writeAction === dbUtils.WRITE_ACTION.REPLACE) {
      const sqlDelete = `DELETE FROM 
        user_stig_asset_map
      WHERE
        userId = ?
        and saId IN (
          SELECT saId from stig_asset_map left join asset using (assetId) where asset.collectionId = ?
        )`
        await connection.execute(sqlDelete, [userId, collectionId])

    }
    if (stigAssets.length > 0) {
      // Get saIds
      const bindsInsertSaIds = [ userId ]
      const predicatesInsertSaIds = []
      for (const stigAsset of stigAssets) {
        bindsInsertSaIds.push(stigAsset.benchmarkId, stigAsset.assetId)
        predicatesInsertSaIds.push('(benchmarkId = ? AND assetId = ?)')
      }
      let sqlInsertSaIds = `INSERT IGNORE INTO user_stig_asset_map (userId, saId) SELECT ?, saId FROM stig_asset_map WHERE `
      sqlInsertSaIds += predicatesInsertSaIds.join('\nOR\n')
      let [result] = await connection.execute(sqlInsertSaIds, bindsInsertSaIds)
    }
    await connection.commit()
  }
  catch (err) {
    if (typeof connection !== 'undefined') {
      await connection.rollback()
    }
    // throw err
    throw ( {status: 500, message: 'Database transaction issue.', stack: err.stack} )

    
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.release()
    }
  }
}

exports.addOrUpdateCollection = async function(writeAction, collectionId, body, projection, userObject) {
  // CREATE: collectionId will be null
  // REPLACE/UPDATE: collectionId is not null
  let connection // available to try, catch, and finally blocks
  try {
    const {grants, ...collectionFields} = body
    // Stringify JSON values
    if ('metadata' in collectionFields) {
      collectionFields.metadata = JSON.stringify(collectionFields.metadata)
    }
  
    // Connect to MySQL
    connection = await dbUtils.pool.getConnection()
    connection.config.namedPlaceholders = true
    await connection.query('START TRANSACTION');

    // Process scalar properties
    let binds =  { ...collectionFields}
    if (writeAction === dbUtils.WRITE_ACTION.CREATE) {
      // INSERT into collections
      let sqlInsert =
      `INSERT INTO
          collection
          (name,  workflow, metadata)
        VALUES
          (:name, :workflow, :metadata)`
      let [rows] = await connection.execute(sqlInsert, binds)
      collectionId = rows.insertId
    }
    else if (writeAction === dbUtils.WRITE_ACTION.UPDATE || writeAction === dbUtils.WRITE_ACTION.REPLACE) {
      if (Object.keys(binds).length > 0) {
        // UPDATE into collections
        let sqlUpdate =
        `UPDATE
            collection
          SET
            ?
          WHERE
            collectionId = ?`
        await connection.query(sqlUpdate, [collectionFields, collectionId])
      }
    }
    else {
      throw ( {status: 500, message: 'Invalid writeAction'} )
    }

    // Process grants
    if (grants && writeAction !== dbUtils.WRITE_ACTION.CREATE) {
      // DELETE from collection_grant
      let sqlDeleteGrants = 'DELETE FROM collection_grant where collectionId = ?'
      await connection.execute(sqlDeleteGrants, [collectionId])
    }
    if (grants && grants.length > 0) {
      // INSERT into collection_grant
      let sqlInsertGrants = `
        INSERT INTO 
        collection_grant (collectionId, userId, accessLevel)
        VALUES
          ?`      
      let binds = grants.map(i => [collectionId, i.userId, i.accessLevel])
      await connection.query(sqlInsertGrants, [binds])
    }
    

    // Commit the changes
    await connection.commit()
  }
  catch (err) {
    await connection.rollback()
    throw err
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.release()
    }
  }

  try {
    let row = await _this.getCollection(collectionId, projection, true, userObject)
    return row
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

/**
 * Create a Collection
 *
 * body CollectionAssign  (optional)
 * returns List
 **/
exports.createCollection = async function(body, projection, userObject) {
  try {
    let row = await _this.addOrUpdateCollection(dbUtils.WRITE_ACTION.CREATE, null, body, projection, userObject)
    return (row)
  }
  finally {}
}


/**
 * Delete a Collection
 *
 * collectionId Integer A path parameter that indentifies a Collection
 * returns CollectionInfo
 **/
exports.deleteCollection = async function(collectionId, projection, elevate, userObject) {
  try {
    let row = await _this.queryCollections(projection, { collectionId: collectionId }, elevate, userObject)
    let sqlDelete = `DELETE FROM collection where collectionId = ?`
    await dbUtils.pool.query(sqlDelete, [collectionId])
    return (row[0])
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}


/**
 * Return the Checklist for the supplied Collection and STIG 
 *
 * collectionId Integer A path parameter that indentifies a Collection
 * benchmarkId String A path parameter that indentifies a STIG
 * revisionStr String A path parameter that indentifies a STIG revision [ V{version_num}R{release_num} | 'latest' ]
 * returns CollectionChecklist
 **/
exports.getChecklistByCollectionStig = async function (collectionId, benchmarkId, revisionStr, userObject ) {
  let connection
  try {
    const joins = [
      'asset a',
      'left join stig_asset_map sa on a.assetId=sa.assetId',
      'left join current_rev rev on sa.benchmarkId=rev.benchmarkId',
      'left join rev_group_map rg on rev.revId=rg.revId',
      'left join `group` g on rg.groupId=g.groupId',
      'left join rev_group_rule_map rgr on rg.rgId=rgr.rgId',
      'left join rule rules on rgr.ruleId=rules.ruleId',
      'left join rule_oval_map scap on rgr.ruleId=scap.ruleId',
      'left join review r on (rgr.ruleId=r.ruleId and sa.assetId=r.assetId)'
    ]

    const predicates = {
      statements: [
        'a.collectionId = :collectionId',
        'rev.benchmarkId = :benchmarkId'
      ],
      binds: {
        collectionId: collectionId,
        benchmarkId: benchmarkId
      }
    }

    // Non-current revision
    if (revisionStr !== 'latest') {
      joins.splice(2, 1, 'left join revision rev on sa.benchmarkId=rev.benchmarkId')
      const results = /V(\d+)R(\d+(\.\d+)?)/.exec(revisionStr)
      predicates.statements.push('rev.version = :version')
      predicates.statements.push('rev.release = :release')
      predicates.binds.version = results[1]
      predicates.binds.release = results[2]
    }

    // Access control
    if (!userObject.privileges.globalAccess) {
      const collectionGrant = userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
      if (collectionGrant && collectionGrant.accessLevel === 1) {
        predicates.statements.push(`a.assetId in (
          select
              sa.assetId
          from
              user_stig_asset_map usa 
              left join stig_asset_map sa on (usa.saId=sa.saId and sa.benchmarkId = :benchmarkId) 
          where
              usa.userId=:userId)`)
        predicates.binds.userId = userObject.userId
      }
    } 
  
    const sql = `
      select
        r.ruleId
        ,r.ruleTitle
        ,r.groupId
        ,r.groupTitle
        ,r.severity
        ,cast(r.autoCheckAvailable is true as json) as autoCheckAvailable
        ,json_object(
          'results', json_object(
            'pass', sum(CASE WHEN r.resultId = 3 THEN 1 ELSE 0 END),
            'fail', sum(CASE WHEN r.resultId = 4 THEN 1 ELSE 0 END),
            'notapplicable', sum(CASE WHEN r.resultId = 2 THEN 1 ELSE 0 END),
            'notchecked', sum(CASE WHEN r.resultId is null THEN 1 ELSE 0 END)
          ),
          'statuses', json_object(
            'saved', sum(CASE WHEN r.statusId = 0 THEN 1 ELSE 0 END),
            'submitted', sum(CASE WHEN r.statusId = 1 THEN 1 ELSE 0 END),
            'rejected', sum(CASE WHEN r.statusId = 2 THEN 1 ELSE 0 END),
            'accepted', sum(CASE WHEN r.statusId = 3 THEN 1 ELSE 0 END)
          )
        ) as counts
      from (
        select
          a.assetId
          ,rgr.ruleId
          ,rules.title as ruleTitle
          ,rules.severity
          ,rg.groupId
          ,g.title as groupTitle
          ,r.resultId
          ,r.statusId
          ,CASE WHEN COUNT(scap.ruleId) = 0 THEN 0 ELSE 1 END as "autoCheckAvailable"
        from
          ${joins.join('\n')}
        where
          ${predicates.statements.join(' and ')}
        group by
          a.assetId
          ,rgr.ruleId
          ,rules.title
          ,rules.severity
          ,rg.groupId
          ,g.title
          ,r.resultId
          ,r.statusId          
        ) r
      group by
        r.ruleId
        ,r.ruleTitle
        ,r.severity
        ,r.groupId
        ,r.groupTitle
        ,r.autoCheckAvailable
      order by
        substring(r.groupId from 3) + 0
    `
    // Send query
    connection = await dbUtils.pool.getConnection()
    connection.config.namedPlaceholders = true
    const [rows] = await connection.query(sql, predicates.binds)
    // for (const row of rows) {
    //   row.autoCheckAvailable = row.autoCheckAvailable === 1 ? true : false
    // }
    return (rows)
  }
  catch (err) {
    throw ( {status: 500,  message: err.message, stack: err.stack })
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.release()
    }
  }
}


/**
 * Return a Collection
 *
 * collectionId Integer A path parameter that indentifies a Collection
 * returns CollectionInfo
 **/
exports.getCollection = async function(collectionId, projection, elevate, userObject) {
  try {
    let rows = await _this.queryCollections(projection, {
      collectionId: collectionId
    }, elevate, userObject)
  return (rows[0])
  }
  // catch (err) {
  //   throw (err)
  // }
  finally{}
}


/**
 * Return a list of Collections accessible to the user
 *
 * returns List
 **/
exports.getCollections = async function(predicates, projection, elevate, userObject) {
  try {
    let rows = await _this.queryCollections(projection, predicates, elevate, userObject)
    return (rows)
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.getFindingsByCollection = async function( collectionId, aggregator, benchmarkId, assetId, acceptedOnly, projection, userObject ) {
  try {
    let rows = await _this.queryFindings(aggregator, projection, { 
      collectionId: collectionId,
      benchmarkId: benchmarkId,
      assetId: assetId,
      acceptedOnly: acceptedOnly
    }, userObject)
    return (rows)
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }

}

exports.getStatusByCollection = async function( collectionId, assetId, benchmarkId, userObject ) {
  try {
    let rows = await _this.queryStatus({ 
      collectionId: collectionId,
      benchmarkId: benchmarkId,
      assetId: assetId
     }, userObject)
    return (rows)
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.getStigAssetsByCollectionUser = async function (collectionId, userId, elevate, userObject) {
  try {
    let rows = await _this.queryStigAssets([], { 
      collectionId: collectionId,
      userId: userId
    }, userObject)
    return (rows)
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }

}

exports.getStigsByCollection = async function( collectionId, elevate, userObject ) {
  try {
    let context
    if (userObject.privileges.globalAccess) {
      context = dbUtils.CONTEXT_ALL
    }
    else {
      context = dbUtils.CONTEXT_USER
    }

    let columns = [
      'cr.benchmarkId',
      'concat("V", cr.version, "R", cr.release) as lastRevisionStr',
      `date_format(cr.benchmarkDateSql,'%Y-%m-%d') as lastRevisionDate`,
      'st.title',
      'cr.ruleCount',
      'COUNT(a.assetId) as assetCount',
      'CAST(SUM(sas.acceptedManual) + SUM(sas.acceptedAuto) AS SIGNED) as acceptedCount',
      'CAST(SUM(sas.submittedManual) + SUM(sas.submittedAuto) AS SIGNED) as submittedCount',
      'CAST(SUM(sas.savedManual) + SUM(sas.savedAuto) AS SIGNED) as savedCount'
    ]

    let joins = [
      'collection c',
      'left join collection_grant cg on c.collectionId = cg.collectionId',
      'left join asset a on c.collectionId = a.collectionId',
      'inner join stig_asset_map sa on a.assetId = sa.assetId',
      'left join current_rev cr on sa.benchmarkId=cr.benchmarkId',
      'left join stig st on cr.benchmarkId=st.benchmarkId',
      'left join stats_asset_stig sas on sa.assetId = sas.assetId and sa.benchmarkId = sas.benchmarkId'
    ]

    // PREDICATES
    let predicates = {
      statements: [],
      binds: []
    }
    predicates.statements.push('c.collectionId = ?')
    predicates.binds.push( collectionId )
    if (context == dbUtils.CONTEXT_USER) {
      joins.push('left join user_stig_asset_map usa on sa.saId = usa.saId')
      predicates.statements.push('(cg.userId = ? AND CASE WHEN cg.accessLevel = 1 THEN usa.userId = cg.userId ELSE TRUE END)')
      predicates.binds.push( userObject.userId )
    }
    // CONSTRUCT MAIN QUERY
    let sql = 'SELECT '
    sql+= columns.join(",\n")
    sql += ' FROM '
    sql+= joins.join(" \n")
    if (predicates.statements.length > 0) {
      sql += "\nWHERE " + predicates.statements.join(" and ")
    }
    sql += ' group by cr.benchmarkId, cr.version, cr.release, cr.benchmarkDateSql, st.title, cr.ruleCount '
    sql += ' order by cr.benchmarkId'
    
    let [rows] = await dbUtils.pool.query(sql, predicates.binds)
    return (rows)


    // let rows = await _this.queryCollections(['stigs'], { collectionId: collectionId }, elevate, userObject)
    // return (rows[0].stigs)
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }

}

/**
 * Replace all properties of a Collection
 *
 * body CollectionAssign  (optional)
 * collectionId Integer A path parameter that indentifies a Collection
 * returns CollectionInfo
 **/
exports.replaceCollection = async function( collectionId, body, projection, userObject) {
  try {
    let row = await _this.addOrUpdateCollection(dbUtils.WRITE_ACTION.REPLACE, collectionId, body, projection, userObject)
    return (row)
  } 
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.setStigAssetsByCollectionUser = async function (collectionId, userId, stigAssets, userObject) {
  try {
    let row = await _this.updateOrReplaceUserStigAssets(dbUtils.WRITE_ACTION.REPLACE, collectionId, userId, stigAssets, userObject)
    return (row)
  } 
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

/**
 * Merge updates to a Collection
 *
 * body CollectionAssign  (optional)
 * collectionId Integer A path parameter that indentifies a Collection
 * returns CollectionInfo
 **/
exports.updateCollection = async function( collectionId, body, projection, userObject) {
  try {
    let row = await _this.addOrUpdateCollection(dbUtils.WRITE_ACTION.UPDATE, collectionId, body, projection, userObject)
    return (row)
  } 
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}


exports.getCollectionMetadataKeys = async function ( collectionId ) {
  const binds = []
  let sql = `
    select
      JSON_KEYS(metadata) as keyArray
    from 
      collection
    where 
      collectionId = ?`
  binds.push(collectionId)
  let [rows] = await dbUtils.pool.query(sql, binds)
  return rows.length > 0 ? rows[0].keyArray : []
}

exports.getCollectionMetadata = async function ( collectionId ) {
  const binds = []
  let sql = `
    select
      metadata 
    from 
      collection
    where 
      collectionId = ?`
  binds.push(collectionId)
  let [rows] = await dbUtils.pool.query(sql, binds)
  return rows.length > 0 ? rows[0].metadata : {}
}

exports.patchCollectionMetadata = async function ( collectionId, metadata ) {
  const binds = []
  let sql = `
    update
      collection 
    set 
      metadata = JSON_MERGE_PATCH(metadata, ?)
    where 
      collectionId = ?`
  binds.push(JSON.stringify(metadata), collectionId)
  let [rows] = await dbUtils.pool.query(sql, binds)
  return true
}

exports.putCollectionMetadata = async function ( collectionId, metadata ) {
  const binds = []
  let sql = `
    update
      collection
    set 
      metadata = ?
    where 
      collectionId = ?`
  binds.push(JSON.stringify(metadata), collectionId)
  let [rows] = await dbUtils.pool.query(sql, binds)
  return true
}

exports.getCollectionMetadataValue = async function ( collectionId, key ) {
  const binds = []
  let sql = `
    select
      JSON_EXTRACT(metadata, ?) as value
    from 
      collection
    where 
      collectionId = ?`
  binds.push(`$."${key}"`, collectionId)
  let [rows] = await dbUtils.pool.query(sql, binds)
  return rows.length > 0 ? rows[0].value : ""
}

exports.putCollectionMetadataValue = async function ( collectionId, key, value ) {
  const binds = []
  let sql = `
    update
      collection
    set 
      metadata = JSON_SET(metadata, ?, ?)
    where 
      collectionId = ?`
  binds.push(`$."${key}"`, value, collectionId)
  let [rows] = await dbUtils.pool.query(sql, binds)
  return rows.length > 0 ? rows[0].value : ""
}

exports.deleteCollectionMetadataKey = async function ( collectionId, key ) {
  const binds = []
  let sql = `
    update
      collection
    set 
      metadata = JSON_REMOVE(metadata, ?)
    where 
      collectionId = ?`
  binds.push(`$."${key}"`, collectionId)
  let [rows] = await dbUtils.pool.query(sql, binds)
  return rows.length > 0 ? rows[0].value : ""
}


/*
Available only to level 3 or 4 users ("Manage" or "Owner")
Returns number of history entries deleted.
RetentionDate - Delete all review history entries prior to the specified date.
Asset Id - if provided, only delete entries for that asset.
*/
exports.deleteReviewHistoryByCollection = async function (collectionId, retentionDate, assetId) {
  let sql = `
    DELETE rh 
    FROM review_history rh 
      INNER JOIN review r on rh.reviewId = r.reviewId
      INNER JOIN asset a on r.assetId = a.assetId
    WHERE a.collectionId = :collectionId
      AND rh.ts < :retentionDate`

  if(assetId) {
    sql += ' AND a.assetId = :assetId'
  }

  let binds = {
    collectionId: collectionId,
    retentionDate: retentionDate,
    assetId: assetId
  }  

  let [rows] = await dbUtils.pool.query(sql, binds)
  let result = {
    HistoryEntriesDeleted: rows.affectedRows
  }
  return (result)
}

/*
GET /collections/{collectionId}/review-history
Available to level 2 and higher users with a grant to the collection.
Returns block of review history entries that fit criteria. Takes optional:
Start Date
End Date
(If no dates provided, return all history. If only one date, return block from that date to current, or that date to oldest, as appropriate)
Asset ID - only return history for this asset id
Rule ID - only return history for this rule id
status- only return history with this status
If rule and asset id provided, return that intersection.
*/
exports.getReviewHistoryByCollection = async function (collectionId, startDate, endDate, assetId, ruleId, status) {
  let binds = {
    collectionId: collectionId
  }
  
  let sql = `
    SELECT a.assetId, 
      (select coalesce(
        (select json_arrayagg(
          json_object
            (
            'ruleId', rv.ruleId,
            'ts', rh.ts, 
            'result', result.api,
            'resultComment', rh.resultComment,
            'action', action.api,
            'actionComment', rh.actionComment,
            'autoResult', rh.autoResult = 1,
            'status', status.api,
            'userId', rh.userId,
            'username', ud.username,
            'rejectText', rh.rejectText,
            'rejectUserId', rh.rejectUserId
            )
          )
          FROM review_history rh
            INNER JOIN review rv on rh.reviewId = rv.reviewId
            INNER JOIN user_data ud on rh.userId = ud.userId
            INNER JOIN result on rh.resultId = result.resultId
            INNER JOIN status on rh.statusId = status.statusId
            INNER JOIN action on rh.actionId = action.actionId
          WHERE rv.assetId = a.assetId`

  if (startDate) {
    binds.startDate = startDate
    sql += " AND rh.ts >= :startDate"
  }

  if (endDate) {
    binds.endDate = endDate
    sql += " AND rh.ts <= :endDate"
  }

  if(ruleId) {
    binds.ruleId = ruleId
    sql += " AND rv.ruleId = :ruleId"
  }

  if(status) {
    binds.statusId = dbUtils.REVIEW_STATUS_API[status]
    sql += ' AND rh.statusId = :statusId'
  }
  
  sql += `
          ), json_array()
        )
      ) as history
    FROM asset a
    WHERE a.collectionId = :collectionId
  `

  if(assetId) {
    binds.assetId = assetId
    sql += " AND a.assetId = :assetId"
  }

  try {
    let [rows] = await dbUtils.pool.query(sql, binds)
    return (rows)
  }
  catch(err) {
    throw ( {status: 500, message: err.message, stack: err.stack} ) 
  }
}

/*
GET /collections/{collectionId}/review-history/stats
Available to level 2 and higher users with a grant to the collection.
Return some simple stats about the number/properties of history entries.
Uses same params as GET review-history, expecting stats to be scoped to whatever would be returned by that query.
Projection: asset - Break out statistics by Asset in the specified collection
*/
exports.getReviewHistoryStatsByCollection = async function (collectionId, startDate, endDate, assetId, ruleId, status, projection) {

  let binds = {
    collectionId: collectionId
  }

  let sql = 'SELECT COUNT(*) as collectionHistoryEntryCount, MIN(rh.ts) as oldestHistoryEntryDate'

  if (projection && projection.includes('asset')) {
    sql += `, coalesce(
      (SELECT json_arrayagg(
        json_object(
          'assetId', assetId,
          'historyEntryCount', historyEntryCount,
          'oldestHistoryEntry', oldestHistoryEntry
          )
        )
        FROM 
        (
          SELECT a.assetId, COUNT(*) as historyEntryCount, MIN(rh.ts) as oldestHistoryEntry
          FROM review_history rh
            INNER JOIN review rv on rh.reviewId = rv.reviewId
            INNER JOIN asset a on rv.assetId = a.assetId
          WHERE a.collectionId = :collectionId
          additionalPredicates
          GROUP BY a.assetId
        ) v
      ), json_array()
      ) as assetHistoryEntryCounts`
  }

  sql += `
    FROM review_history rh
      INNER JOIN review rv on rh.reviewId = rv.reviewId
      INNER JOIN asset a on rv.assetId = a.assetId
    WHERE a.collectionId = :collectionId
    additionalPredicates
  `

  let additionalPredicates = ""

  if (startDate) {
    binds.startDate = startDate
    additionalPredicates += " AND rh.ts >= :startDate"
  }

  if (endDate) {
    binds.endDate = endDate
    additionalPredicates += " AND rh.ts <= :endDate"
  }

  if(ruleId) {
    binds.ruleId = ruleId
    additionalPredicates += " AND rv.ruleId = :ruleId"
  }

  if(status) {
    binds.statusId = dbUtils.REVIEW_STATUS_API[status]
    additionalPredicates += ' AND rh.statusId = :statusId'
  }
  
  if(assetId) {
    binds.assetId = assetId
    additionalPredicates += " AND a.assetId = :assetId"
  }

  sql = sql.replace(/additionalPredicates/g, additionalPredicates)


  try {
    let [rows] = await dbUtils.pool.query(sql, binds)
    return (rows[0])
  }
  catch(err) {
    throw ( {status: 500, message: err.message, stack: err.stack} ) 
  }

}