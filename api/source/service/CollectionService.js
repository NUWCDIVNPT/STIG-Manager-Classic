'use strict';
const dbUtils = require('./utils')
const config = require('../utils/config.js')
const MyController = require('../controllers/Collection')
const SmError = require('../utils/error.js')

const _this = this

exports.queryCollection = async function ({collectionId, projections = [], elevate = false, grants = {}}) {
  const groupBy = []
  const orderBy = []
  const ctes = []
  const columns = [
    'CAST(c.collectionId as char) as collectionId',
    'c.name',
    'c.description',
    'c.settings',
    'c.metadata'
  ]
  const joins = ['collection c']

  let requireCteGrantees = false
  let requireCteAcls = false
  let requireCteAssets = false
  let requireCteStigs = false
  let requireCteLabels = ''

  const predicates = {
    statements: [`c.state = "enabled"`],
    binds: []
  }

  const requesterRole = elevate ? 4 : grants[collectionId].roleId
  const requesterGrantIds = grants[collectionId]?.grantIds
  predicates.statements.push('c.collectionId = ?')
  predicates.binds.push( collectionId )

  if (projections.includes('assets')) {
    let sqlAssets = `(select coalesce(${dbUtils.jsonArrayAgg({
      value: `json_object(
      'assetId', CAST(assetId as char), 
      'name', name)`,
      orderBy: 'name'
      })}, json_array()) from
      ${requesterRole === 1 ? 'cteAssets' : 'asset where collectionId = c.collectionId and state = "enabled"'}) as assets`
      if (requesterRole === 1) {
      requireCteAcls = true
      requireCteAssets = true
    }
    columns.push(sqlAssets)
  }

  if (projections.includes('stigs')) {
    if (requesterRole === 1) {
      requireCteAcls = true
      requireCteStigs = true
      columns.push(`(select coalesce(json_arrayagg(json_object(
      'benchmarkId', benchmarkId, 
      'revisionStr', revisionStr,
      'benchmarkDate', benchmarkDate,
      'revisionPinned', revisionPinned,
      'ruleCount', ruleCount
      )), json_array()) from cteStigs) as stigs`)
    }
    else {
      columns.push(`(select coalesce(json_arrayagg(json_object(
        'benchmarkId', cb.benchmarkId, 
        'revisionStr', revision.revisionStr,
        'benchmarkDate', date_format(revision.benchmarkDateSql,'%Y-%m-%d'),
        'revisionPinned', CASE WHEN dr.revisionPinned = 1 THEN CAST(true as json) ELSE CAST(false as json) END,
        'ruleCount', revision.ruleCount
        )), json_array())
        from 
		    (select distinct sa.benchmarkId from asset a
        inner join stig_asset_map sa on a.assetId = sa.assetId
        where a.collectionId = c.collectionId) cb
        left join default_rev dr on (cb.benchmarkId=dr.benchmarkId and dr.collectionId = c.collectionId)
        left join revision on dr.revId = revision.revId) as stigs`)
    }
  }

  if (projections.includes('grants')) { 
    columns.push(`(select
      coalesce(
        (select json_arrayagg(grantJson) from
          (select
            json_object(
              'grantId', cast(grantId as char),
              'user', json_object(
              'userId', CAST(user_data.userId as char),
              'username', user_data.username,
              'displayName', COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(user_data.lastClaims, "$.${config.oauth.claims.name}")),
                user_data.username)),
              'roleId', roleId)
            as grantJson
          from
            collection_grant inner join user_data using (userId) where collectionId = c.collectionId
          UNION
          select
            json_object(
              'grantId', cast(grantId as char),
              'userGroup', json_object(
                'userGroupId', CAST(user_group.userGroupId as char),
                'name', user_group.name,
                'description', user_group.description
                ),
              'roleId', roleId
            ) as grantJson
          from collection_grant inner join user_group using (userGroupId) where collectionId = c.collectionId
        ) as grantJsons)
      , json_array()
      )
    ) as "grants"`)
  }

  if (projections.includes('users')) {
    requireCteGrantees = true
    columns.push(`(select 
    json_arrayagg(json_object(
    'user', json_object(
      'userId', CAST(ud.userId as char),
      'username', ud.username,
      'displayName', COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(ud.lastClaims, "$.${config.oauth.claims.name}")),
      ud.username)),
    'roleId', cgs.roleId,
    'grantees', cgs.grantees))
    from cteGrantees cgs 
    inner join user_data ud on cgs.userId = ud.userId
    ) as users`)
  }

  if (projections.includes('labels')) {
    if (requesterRole === 1) {
      requireCteAcls = true
      requireCteLabels = 'restricted'
    }
    else {
      requireCteLabels = 'all'
    }
    columns.push(`(select
      coalesce(json_arrayagg(json_object(
        'labelId', labelId, 
        'name', name,
        'description', description,
        'color', color,
        'uses', uses
        )), json_array())
      from
        cteLabels) as labels`)
  }

  if (projections.includes('owners')) {
    columns.push(`(select coalesce(json_arrayagg(grantJson),json_array()) from
      (select user_data.username, json_object(
        'userId', CAST(user_data.userId as char),
        'username', user_data.username,
        'displayName', JSON_UNQUOTE(JSON_EXTRACT(user_data.lastClaims, "$.${config.oauth.claims.name}"))
        ) as grantJson
      from
        collection_grant inner join user_data using (userId) where collectionId = c.collectionId and roleId = 4
      UNION
      select user_group.name, json_object(
        'userGroupId', CAST(user_group.userGroupId as char),
        'name', user_group.name,
        'description', user_group.description
      ) as grantJson
      from collection_grant inner join user_group using (userGroupId) where collectionId = c.collectionId and roleId = 4 order by username) o) as owners`)
  }

  if (projections.includes('statistics')) {
    if (requesterRole === 1) {
      requireCteGrantees = true
      requireCteAcls = true
      columns.push(`(select
      json_object(
      'created', DATE_FORMAT(c.created, '%Y-%m-%dT%TZ'),
      'userCount', dt4.userCount,
      'assetCount', dt4.assetCount,
      'checklistCount', dt4.checklistCount
      )
      from 
        (SELECT
        (select count(userId) from cteGrantees where collectionId = c.collectionId) as userCount,
        (select count(distinct sa.assetId) from cteAclEffective cae left join stig_asset_map sa using (saId)) as assetCount,
        (select count(saId) from cteAclEffective) as checklistCount) dt4
      ) as statistics`)
    }
    else {
      requireCteGrantees = true
      columns.push(`(select
        json_object(
        'created', DATE_FORMAT(c.created, '%Y-%m-%dT%TZ'),
        'userCount', dt4.userCount,
        'assetCount', dt4.assetCount,
        'checklistCount', dt4.checklistCount
        )
        from 
          (SELECT
          (select count(userId) from cteGrantees where collectionId = c.collectionId) as userCount,
          (select count(distinct a.assetId) from asset a where a.collectionId = c.collectionId and state = "enabled") as assetCount,
          (select count(saId) from asset a left join stig_asset_map sa using (assetId) where a.collectionId = c.collectionId and a.state = 'enabled') as checklistCount) dt4
        ) as statistics`)

    }
  }

  // setup ctes
  if (requireCteGrantees) {
    const cteGranteesParams = {collectionId: collectionId, returnCte: true}
    ctes.push(dbUtils.sqlGrantees(cteGranteesParams))
  }
  if (requireCteAcls) {
    ctes.push(dbUtils.cteAclEffective({grantIds: requesterGrantIds, includeColumnCollectionId: false}))
  }
  if (requireCteAssets) {
    ctes.push(`cteAssets as (select distinct a.assetId, a.name from 
    cteAclRules ar
    inner join stig_asset_map sa using (saId)
    left join asset a using (assetId)
    order by a.name)`)
  }
  if (requireCteStigs) {
    ctes.push(`cteStigs as (
    select distinct
      sa.benchmarkId,
      revision.revisionStr,
      date_format(revision.benchmarkDateSql,'%Y-%m-%d') as benchmarkDate,
      CASE WHEN dr.revisionPinned = 1 THEN CAST(true as json) ELSE CAST(false as json) END as revisionPinned,
      revision.ruleCount
    from
      cteAclRules ar
      inner join stig_asset_map sa using (saId)
      left join default_rev dr on (sa.benchmarkId=dr.benchmarkId and dr.collectionId = ${collectionId})
      left join revision on dr.revId = revision.revId
    order by sa.benchmarkId)`)
  }
  if (requireCteLabels) {
    ctes.push(`cteLabels as (
    select
      BIN_TO_UUID(cl.uuid,1) labelId,
      cl.name,
      cl.description,
      cl.color,
      count(distinct cla.claId) as uses
    from
      collection_label cl
      left join collection_label_asset_map cla on cla.clId = cl.clId
      ${requireCteLabels === 'restricted' ? 'left join stig_asset_map sa on cla.assetId = sa.assetId' : ''}
      ${requireCteLabels === 'restricted' ? 'inner join cteAclEffective cae on sa.saId = cae.saId' : ''}
    where
      cl.collectionId = ${collectionId}
    group by
      cl.clId)`)
  }

  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  const [rows] = await dbUtils.pool.query(sql)

  return rows[0]  
}

/**
Generalized queries for collection(s).
**/
exports.queryCollections = async function ({projections = [], filter = {}, elevate = false, grants = {}, userId = ''}) {  
    const collectionIdsGranted = Object.keys(grants)
    if (!collectionIdsGranted.length && !elevate) {
      return []
    }

    const ctes = []
    const columns = [
      'CAST(c.collectionId as char) as collectionId',
      'c.name',
      'c.description',
      'c.settings',
      'c.metadata'
    ]
    const joins = ['collection c']
    const predicates = {
      statements: [`c.state = "enabled"`],
      binds: []
    }
    const orderBy = ['c.name']

    let requireCteGrantees = false
    let requireCteAcls = false
    let requesterGrantIds = []

    if (!elevate) {
      for (const collectionId in grants) {
        requesterGrantIds.push(grants[collectionId].grantIds)
      }
      requesterGrantIds = requesterGrantIds.flat()
    }

    if (projections.includes('owners')) {
      columns.push(`(select coalesce(json_arrayagg(grantJson),json_array()) from
        (select json_object(
          'userId', CAST(user_data.userId as char),
          'username', user_data.username,
          'displayName', JSON_UNQUOTE(JSON_EXTRACT(user_data.lastClaims, "$.${config.oauth.claims.name}"))
          ) as grantJson
        from
          collection_grant inner join user_data using (userId) where collectionId = c.collectionId and roleId = 4
        UNION
        select json_object(
          'userGroupId', CAST(user_group.userGroupId as char),
          'name', user_group.name,
          'description', user_group.description
        ) as grantJson
        from collection_grant inner join user_group using (userGroupId) where collectionId = c.collectionId and roleId = 4) o) as owners`)
    }
    if (projections.includes('statistics')) {
      if (!elevate) {
        requireCteGrantees = true
        requireCteAcls = true
        columns.push(`(select
          json_object(
          'created', DATE_FORMAT(c.created, '%Y-%m-%dT%TZ'),
          'userCount', dt4.userCount,
          'assetCount', case when dt4.roleId = 1 then dt4.assetGrantedCount else dt4.assetCount end,
          'checklistCount', case when dt4.roleId = 1 then dt4.checklistGrantedCount else dt4.checklistCount end
          )
          from 
            (SELECT
            (select roleId from cteGrantees where collectionId = c.collectionId and userId = ?) as roleId,
            (select count(userId) from cteGrantees where collectionId = c.collectionId) as userCount,
            (select count(distinct a.assetId) from asset a where a.collectionId = c.collectionId and a.state = "enabled") as assetCount,
            (select count(distinct sa.assetId) from cteAclEffective cae left join stig_asset_map sa using (saId) where cae.collectionId = c.collectionId) as assetGrantedCount,
            (select count(sa.saId) from asset a left join stig_asset_map sa using (assetId) where a.collectionId = c.collectionId and a.state = "enabled") as checklistCount,
            (select count(saId) from cteAclEffective where collectionId = c.collectionId) as checklistGrantedCount
          ) dt4
        ) as statistics`)
        predicates.binds.push(userId)
      }
      else {
        requireCteGrantees = true
        columns.push(`(select
          json_object(
          'created', DATE_FORMAT(c.created, '%Y-%m-%dT%TZ'),
          'userCount', dt4.userCount,
          'assetCount', dt4.assetCount,
          'checklistCount', dt4.checklistCount
          )
          from 
            (SELECT
            (select count(userId) from cteGrantees where collectionId = c.collectionId) as userCount,
            (select count(distinct a.assetId) from asset a where a.collectionId = c.collectionId and a.state = "enabled") as assetCount,
            (select count(sa.saId) from asset a left join stig_asset_map sa using (assetId) where a.collectionId = c.collectionId and a.state = "enabled") as checklistCount) dt4
          ) as statistics`)
      }
    }
    // This projection is not exposed in the OAS, only used by Operation.getAppData()
    if (projections.includes('grants')) { 
      columns.push(`(select
        coalesce(
          (select json_arrayagg(grantJson) from
            (select
                json_object(
                  'user', json_object(
                  'userId', CAST(user_data.userId as char),
                  'username', user_data.username,
                  'displayName', COALESCE(
                    JSON_UNQUOTE(JSON_EXTRACT(user_data.lastClaims, "$.${config.oauth.claims.name}")),
                    user_data.username)),
                  'roleId', roleId)
                as grantJson
            from
              collection_grant inner join user_data using (userId) where collectionId = c.collectionId
            UNION
            select
              json_object(
                'userGroup', json_object(
                  'userGroupId', CAST(user_group.userGroupId as char),
                  'name', user_group.name,
                  'description', user_group.description
                  ),
                'roleId', roleId
              ) as grantJson
            from collection_grant inner join user_group using (userGroupId) where collectionId = c.collectionId
          ) as grantJsons)
        , json_array()
        )
      ) as "grants"`)
    }


    if (!elevate) {
      predicates.statements.push('c.collectionId IN (?)')
      predicates.binds.push( collectionIdsGranted )
    }
    if ( filter.name ) {
      let matchStr = '= ?'
      if ( filter.nameMatch && filter.nameMatch !== 'exact') {
        matchStr = 'LIKE ?'
        switch (filter.nameMatch) {
          case 'startsWith':
            filter.name = `${filter.name}%`
            break
          case 'endsWith':
            filter.name = `%${filter.name}`
            break
          case 'contains':
            filter.name = `%${filter.name}%`
            break
        }
      }
      predicates.statements.push(`c.name ${matchStr}`)
      predicates.binds.push( filter.name )
    }
    if ( filter.metadata ) {
      for (const pair of filter.metadata) {
        const [key, value] = pair.split(/:(.*)/s)
        predicates.statements.push('JSON_CONTAINS(c.metadata, ?, ?)')
        predicates.binds.push( `"${value}"`,  `$.${key}`)
      }
    }

    if (requireCteGrantees) {
      const cteGranteesParams = elevate ? {returnCte: true} : {collectionIds: collectionIdsGranted, returnCte: true}
      ctes.push(dbUtils.sqlGrantees(cteGranteesParams))
    }
    if (requireCteAcls) {
      ctes.push(dbUtils.cteAclEffective({grantIds: requesterGrantIds}))
    }

    const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, orderBy, format: true})
    const [rows] = await dbUtils.pool.query(sql)
    return rows  
}


exports.addOrUpdateCollection = async function(writeAction, collectionId, body, projection, userObject, svcStatus = {}) {
  // CREATE: collectionId will be null
  // REPLACE/UPDATE: collectionId is not null
  let connection // available to try, catch, and finally blocks
  try {
    const {grants, labels, ...collectionFields} = body
    // Stringify JSON values
    collectionFields.metadata = JSON.stringify(collectionFields.metadata ?? {})
    // Merge default settings with any provided settings
    collectionFields.settings = JSON.stringify({...MyController.defaultSettings, ...collectionFields.settings})
  
    // Connect to MySQL
    connection = await dbUtils.pool.getConnection()
    connection.config.namedPlaceholders = true
    async function transaction () {
      await connection.query('START TRANSACTION');

      // Process scalar properties
      if (writeAction === dbUtils.WRITE_ACTION.CREATE) {
        // INSERT into collections
        let sqlInsert =
        `INSERT INTO
            collection
            (name, description, settings, metadata)
          VALUES
            (:name, :description, :settings, :metadata)`
        let [rows] = await connection.execute(sqlInsert, collectionFields)
        collectionId = rows.insertId
      }
      else if (writeAction === dbUtils.WRITE_ACTION.UPDATE || writeAction === dbUtils.WRITE_ACTION.REPLACE) {
        if (Object.keys(collectionFields).length > 0) {
          // UPDATE into collections
          const sqlUpdate = `UPDATE collection SET ?  WHERE collectionId = ?`
          await connection.query(sqlUpdate, [collectionFields, collectionId])
        }
      }
      else {
        throw new SmError.InternalError('Invalid writeAction')
      }

      // process grants
      if (grants) {
        if (grants.length) {
          const grantsByIdType = grants.reduce((accumulator, currentValue) => {
            accumulator[currentValue.userId ? 'userGrants' : 'userGroupGrants'].push(currentValue)
            return accumulator
          }, {userGrants:[], userGroupGrants:[]})

          if (grantsByIdType.userGrants.length) {
            await connection.query(
              `DELETE FROM collection_grant WHERE collectionId = ? and userId NOT IN (?)`,
              [collectionId, grantsByIdType.userGrants.map(i => i.userId)]
            )
            const sqlInsertUserGrants = `INSERT
            INTO 
              collection_grant (collectionId, userId, roleId)
            VALUES
              ? as new 
            ON DUPLICATE KEY UPDATE 
              roleId = new.roleId`      
            const binds = grantsByIdType.userGrants.map(i => [collectionId, i.userId, i.roleId])
            await connection.query(sqlInsertUserGrants, [binds])
          }
          else {
            await connection.query(`DELETE FROM collection_grant WHERE collectionId = ? and userId is not null`, [collectionId])
          }

          if (grantsByIdType.userGroupGrants.length) {
            await connection.query(
              `DELETE FROM collection_grant WHERE collectionId = ? and userGroupId NOT IN (?)`,
              [collectionId, grantsByIdType.userGroupGrants.map(i => i.userGroupId)]
            )
            const sqlInsertGroupGrants = `INSERT 
            INTO 
              collection_grant (collectionId, userGroupId, roleId) 
            VALUES
              ? as new
            ON DUPLICATE KEY UPDATE 
              roleId = new.roleId`      
            const binds = grantsByIdType.userGroupGrants.map(i => [collectionId, i.userGroupId, i.roleId])
            await connection.query(sqlInsertGroupGrants, [binds])
          }
          else {
            await connection.query(`DELETE FROM collection_grant WHERE collectionId = ? and userGroupId is not null`, [collectionId]) 
          }
  
        }
        else if (writeAction !== dbUtils.WRITE_ACTION.CREATE) {
          await connection.query(`DELETE FROM collection_grant WHERE collectionId = ?`, [collectionId])
          await connection.query(`DELETE FROM collection_grant_group WHERE collectionId = ?`, [collectionId]) 
        }
      }

      // Process labels
      if (labels && writeAction !== dbUtils.WRITE_ACTION.CREATE) {
        // DELETE from collection_label
        let sqlDeleteLabels = 'DELETE FROM collection_label where collectionId = ?'
        await connection.execute(sqlDeleteLabels, [collectionId])
      }
      if (labels && labels.length > 0) {
        // INSERT into collection_label
        let sqlInsertLabels = `
          INSERT INTO 
          collection_label (collectionId, name, description, color, uuid)
          VALUES
            ?`      
        const binds = labels.map(i => [collectionId, i.name, i.description, i.color, {
          toSqlString: function () {
            return `UUID_TO_BIN(UUID(),1)`
          }
        }])
        await connection.query(sqlInsertLabels, [binds])
      }
  
      // Commit the changes
      await connection.commit()
    }
    await dbUtils.retryOnDeadlock(transaction, svcStatus)
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
  let row = await _this.getCollection(collectionId, projection, true, userObject)
  return row
}

/**
 * Create a Collection
 *
 * body CollectionAssign  (optional)
 * returns List
 **/
exports.createCollection = async function(body, projection, userObject, svcStatus = {}) {
  let row = await _this.addOrUpdateCollection(dbUtils.WRITE_ACTION.CREATE, null, body, projection, userObject, svcStatus)
  return (row)
}


/**
 * Delete a Collection
 *
 * collectionId Integer A path parameter that identifies a Collection
 **/
exports.deleteCollection = async function(collectionId, userId) {
  const sqlDelete = `UPDATE collection SET state = "disabled", stateDate = NOW(), stateUserId = ? where collectionId = ?`
  return dbUtils.pool.query(sqlDelete, [userId, collectionId])
}


/**
 * Return the Checklist for the supplied Collection and STIG 
 *
 * collectionId Integer A path parameter that identifies a Collection
 * benchmarkId String A path parameter that identifies a STIG
 * revisionStr String A path parameter that identifies a STIG revision [ V{version_num}R{release_num} | 'latest' ]
 * returns CollectionChecklist
 **/
exports.getChecklistByCollectionStig = async function (collectionId, benchmarkId, revisionStr, userObject ) {
  const ctes = []
  const groupBy = ['rgr.rgrId']
  const orderBy = ['rgr.ruleId']

  const columns = [
    `rgr.ruleId
    ,rgr.title as ruleTitle
    ,rgr.severity
    ,rgr.\`version\`
    ,rgr.groupId
    ,rgr.groupTitle
    ,json_object(
      'results', json_object(
        'pass', sum(CASE WHEN r.resultId = 3 THEN 1 ELSE 0 END),
        'fail', sum(CASE WHEN r.resultId = 4 THEN 1 ELSE 0 END),
        'notapplicable', sum(CASE WHEN r.resultId = 2 THEN 1 ELSE 0 END),
        'other', sum(CASE WHEN r.resultId is null OR (r.resultId != 2 AND r.resultId != 3 AND r.resultId != 4) THEN 1 ELSE 0 END)
      ),
      'statuses', json_object(
        'saved', sum(CASE WHEN r.statusId = 0 THEN 1 ELSE 0 END),
        'submitted', sum(CASE WHEN r.statusId = 1 THEN 1 ELSE 0 END),
        'rejected', sum(CASE WHEN r.statusId = 2 THEN 1 ELSE 0 END),
        'accepted', sum(CASE WHEN r.statusId = 3 THEN 1 ELSE 0 END)
      )
    ) as counts
    ,json_object(
      'ts', json_object(
        'min', DATE_FORMAT(MIN(r.ts),'%Y-%m-%dT%H:%i:%sZ'),
        'max', DATE_FORMAT(MAX(r.ts),'%Y-%m-%dT%H:%i:%sZ')
      ),
      'statusTs', json_object(
        'min', DATE_FORMAT(MIN(r.statusTs),'%Y-%m-%dT%H:%i:%sZ'),
        'max', DATE_FORMAT(MAX(r.statusTs),'%Y-%m-%dT%H:%i:%sZ')
      ),
      'touchTs', json_object(
        'min', DATE_FORMAT(MIN(r.touchTs),'%Y-%m-%dT%H:%i:%sZ'),
        'max', DATE_FORMAT(MAX(r.touchTs),'%Y-%m-%dT%H:%i:%sZ')
      )
    ) as timestamps`
  ]

  const joins = [
    'asset a',
    'left join stig_asset_map sa using (assetId)',
    'left join current_rev rev using (benchmarkId)',
    'left join rev_group_rule_map rgr using (revId)',
    'left join rule_version_check_digest rvcd using (ruleId)',
    'left join review r on (rvcd.version=r.version and rvcd.checkDigest=r.checkDigest and sa.assetId=r.assetId)'
  ]

  const predicates = {
    statements: [
      'a.collectionId = ?',
      'rev.benchmarkId = ?',
      'a.state = "enabled"'
    ],
    binds: [
      collectionId,
      benchmarkId
    ]
  }

  // Non-current revision
  if (revisionStr !== 'latest') {
    joins.splice(2, 1, 'left join revision rev on sa.benchmarkId=rev.benchmarkId')
    const {version, release} = dbUtils.parseRevisionStr(revisionStr)
    predicates.statements.push('rev.version = ?', 'rev.release = ?')
    predicates.binds.push(version, release)
  }

  // Access control
  const grant = userObject.grants[collectionId]
  if (grant.roleId === 1) {
    ctes.push(dbUtils.cteAclEffective({grantIds: grant.grantIds}))
    joins.push('inner join cteAclEffective cae on sa.saId = cae.saId')
  }

  const sql = dbUtils.makeQueryString({
    ctes,
    columns,
    joins,
    predicates,
    groupBy,
    orderBy,
    format: true
  })

  // Send query
  const [rows] = await dbUtils.pool.query(sql)
  return (rows)
}


/**
 * Return a Collection
 *
 * collectionId Integer A path parameter that identifies a Collection
 * returns CollectionInfo
 **/
exports.getCollection = async function(collectionId, projections, elevate, userObject) {
  return _this.queryCollection({
    collectionId,
    projections,
    elevate,
    grants: userObject.grants
  })
}


exports.getFindingsByCollection = async function( {collectionId, aggregator, benchmarkId, assetId, acceptedOnly, projections, grant} ) {
  let columns, groupBy, orderBy
  switch (aggregator) {
    case 'ruleId':
      columns = [
        'rgr.ruleId',
        'rgr.title',
        'rgr.severity',
        'count(distinct a.assetId) as assetCount'
      ]
      groupBy = [
        'rgr.rgrId'
      ]
      orderBy = ['rgr.ruleId']
      break
    case 'groupId':
      columns = [
        'rgr.groupId',
        'rgr.groupTitle as title',
        'rgr.severity',
        'count(distinct a.assetId) as assetCount'
      ]
      groupBy = [
        'rgr.rgrId'
      ]
      orderBy = ['substring(rgr.groupId from 3) + 0']
      break
    case 'cci':
      columns = [
        'cci.cci',
        'cci.definition',
        'cci.apAcronym',
        'count(distinct a.assetId) as assetCount'
      ]
      groupBy = [
        'cci.cci'
      ]
      orderBy = ['cci.cci']
      break
  }
  const ctes = []
  const joins = [
    'collection c',
    'inner join asset a on (c.collectionId = a.collectionId and a.state = "enabled")',
    'inner join stig_asset_map sa on a.assetId = sa.assetId',
    'left join default_rev dr on (sa.benchmarkId = dr.benchmarkId and c.collectionId = dr.collectionId)',
    'left join rev_group_rule_map rgr on dr.revId = rgr.revId',
    'left join rev_group_rule_cci_map rgrcc using (rgrId)',
    'left join rule_version_check_digest rvcd on rgr.ruleId = rvcd.ruleId',
    'inner join review rv on (rvcd.version = rv.version and rvcd.checkDigest = rv.checkDigest and a.assetId = rv.assetId and rv.resultId = 4)',
    'left join cci on rgrcc.cci = cci.cci'
  ]
  if (grant.roleId === 1) {
    ctes.push(dbUtils.cteAclEffective({grantIds: grant.grantIds}))
    joins.push('inner join cteAclEffective cae on sa.saId = cae.saId')
  }

  // Not exposed in API, used internally
  if (projections.includes('rulesWithDiscussion')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'ruleId', rgr.ruleId,
      'title', rgr.title,
      'severity', rgr.severity,
      'vulnDiscussion', rgr.vulnDiscussion) order by rgr.ruleId), ']') as json) as "rules"`)
  }
  if (projections.includes('rules')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'ruleId', rgr.ruleId,
      'title', rgr.title,
      'version', rgr.version,
      'severity', rgr.severity) order by rgr.ruleId), ']') as json) as "rules"`)
  }
  if (projections.includes('groups')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'groupId', rgr.groupId,
      'title', rgr.groupTitle,
      'severity', rgr.groupSeverity) order by rgr.groupId), ']') as json) as "groups"`)
  }
  if (projections.includes('assets')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'assetId', CAST(a.assetId as char),
      'name', a.name) order by a.name), ']') as json) as "assets"`)
  }
  if (projections.includes('stigs')) {
    joins.push('left join revision on dr.revId = revision.revId')
    columns.push(`cast(
      concat('[', 
        coalesce (
          group_concat(distinct 
            case when revision.benchmarkId is not null then 
              json_object(
                'benchmarkId', revision.benchmarkId, 
                'revisionStr', revision.revisionStr, 
                'benchmarkDate', date_format(revision.benchmarkDateSql,'%Y-%m-%d'),
                'revisionPinned', CASE WHEN dr.revisionPinned = 1 THEN CAST(true as json) ELSE CAST(false as json) END, 
                'ruleCount', revision.ruleCount)
            else null end 
          order by revision.benchmarkId),
          ''),
      ']')
    as json) as "stigs"`)

    // columns.push(`cast( concat( '[', group_concat(distinct concat('"',dr.benchmarkId,'"')), ']' ) as json ) as "stigs"`)
  }
  if (projections.includes('ccis')) {
    columns.push(`cast(concat('[', 
    coalesce(
      group_concat(distinct 
      case when cci.cci is not null
      then json_object(
        'cci', cci.cci,
        'definition', cci.definition,
        'apAcronym', cci.apAcronym)
      else null end order by cci.cci),
      ''),
    ']') as json) as "ccis"`)
  }

  const predicates = {
    statements: [
      'c.state = "enabled"',
      'c.collectionId = ?'
    ],
    binds: [collectionId]
  }
  if (assetId) {
    predicates.statements.push('a.assetId = ?')
    predicates.binds.push( assetId )
  }
  if (acceptedOnly) {
    predicates.statements.push('rv.statusId = ?')
    predicates.binds.push( 3 )
  }
  if (benchmarkId) {
    predicates.statements.push('dr.benchmarkId = ?')
    predicates.binds.push( benchmarkId )
  }
  
  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  const [rows] = await dbUtils.pool.query(sql)
  return (rows)
}

exports.getReviewAclByCollectionUser = async function (collectionId, userId, elevate, userObject) {
  let rows = await _this.queryReviewAcl({collectionId, userId})
  return (rows)
}
exports.getReviewAclByCollectionUserGroup = async function (collectionId, userGroupId, elevate, userObject) {
  let rows = await _this.queryReviewAcl({collectionId, userGroupId})
  return (rows)
}


exports.getStigsByCollection = async function({collectionId, labelIds, labelNames, labelMatch, grant, benchmarkId, projections}) {
  const ctes = []
  
  const columns = [
    'sa.benchmarkId',
    'stig.title',
    'revision.revisionStr',
    `date_format(revision.benchmarkDateSql,'%Y-%m-%d') as benchmarkDate`,
    'CASE WHEN dr.revisionPinned = 1 THEN CAST(true as json) ELSE CAST(false as json) END as revisionPinned',
    'revision.ruleCount',
    'count(sa.assetId) as assetCount'
  ]

  const groupBy = ['sa.benchmarkId', 'revision.revId', 'dr.revisionPinned', 'stig.benchmarkId']
  const orderBy = ['sa.benchmarkId']

  const joins = [
    'collection c',
    'left join asset a on c.collectionId = a.collectionId',
    'inner join stig_asset_map sa on a.assetId = sa.assetId',
    'left join default_rev dr on (sa.benchmarkId = dr.benchmarkId and c.collectionId = dr.collectionId)',
    'left join revision on dr.revId = revision.revId',
    'left join stig on revision.benchmarkId = stig.benchmarkId'
  ]

  // PREDICATES
  const predicates = {
    statements: [
      'a.state = "enabled"',
      'c.collectionId = ?'
    ],
    binds: [collectionId]
  }
  if (labelIds || labelNames || labelMatch) {
    joins.push(
      'left join collection_label_asset_map cla2 on a.assetId = cla2.assetId',
      'left join collection_label cl2 on cla2.clId = cl2.clId'
    )
    const labelPredicates = []
    if (labelIds) {
      labelPredicates.push('cl2.uuid IN ?')
      const uuidBinds = labelIds.map( uuid => dbUtils.uuidToSqlString(uuid))
      predicates.binds.push([uuidBinds])
    }
    if (labelNames) {
      labelPredicates.push('cl2.name IN ?')
      predicates.binds.push([labelNames])
    }
    if (labelMatch === 'null') {
      labelPredicates.push('cl2.uuid IS NULL')
    }
    const labelPredicatesClause = `(${labelPredicates.join(' OR ')})`
    predicates.statements.push(labelPredicatesClause)
  }
  if (benchmarkId) {
    predicates.statements.push('sa.benchmarkId = ?')
    predicates.binds.push( benchmarkId )
  }
  if (projections?.includes('assets')) {
    columns.push(`cast(concat('[', group_concat(distinct json_object (
      'assetId', CAST(a.assetId as char),
      'name', a.name) order by a.name), ']') as json) as "assets"`)
  }

  if (grant.roleId === 1) {
    ctes.push(dbUtils.cteAclEffective({grantIds: grant.grantIds}))
    joins.push('inner join cteAclEffective cae on sa.saId = cae.saId')
  }

  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  const [rows] = await dbUtils.pool.query(sql)
  return (rows)
}

/**
 * Replace all properties of a Collection
 *
 * body CollectionAssign  (optional)
 * collectionId Integer A path parameter that identifies a Collection
 * returns CollectionInfo
 **/
exports.replaceCollection = async function( collectionId, body, projection, userObject, svcStatus = {}) {
  let row = await _this.addOrUpdateCollection(dbUtils.WRITE_ACTION.REPLACE, collectionId, body, projection, userObject, svcStatus)
  return (row)
}

/**
 * Merge updates to a Collection
 *
 * body CollectionAssign  (optional)
 * collectionId Integer A path parameter that identifies a Collection
 * returns CollectionInfo
 **/
exports.updateCollection = async function( collectionId, body, projection, userObject, svcStatus = {}) {
  let row = await _this.addOrUpdateCollection(dbUtils.WRITE_ACTION.UPDATE, collectionId, body, projection, userObject, svcStatus)
  return (row)
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
  await dbUtils.pool.query(sql, binds)
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
  await dbUtils.pool.query(sql, binds)
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
      AND rh.touchTs < :retentionDate`

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

  const columns = [
    `CAST(innerQuery.assetId as char) as assetId,
      json_arrayagg(
        json_object(
          'ruleId', innerQuery.ruleId,
          'history', innerQuery.history
        )
      ) as reviewHistories
    from
      (select 
        a.assetId, 
        rv.ruleId, 
        json_arrayagg(
          json_object(
            'ts', DATE_FORMAT(rh.ts, '%Y-%m-%dT%TZ'),
            'ruleId', rh.ruleId,
            'result', result.api,
            'detail', COALESCE(LEFT(rh.detail,32767), ''),
            'comment', COALESCE(LEFT(rh.comment,32767), ''),
            'autoResult', rh.autoResult = 1,
            'status', JSON_OBJECT(
              'label', status.api,
              'text', rh.statusText,
              'user', JSON_OBJECT(
                'userId', CAST(rh.statusUserId as char),
                'username', udStatus.username
              ),
              'ts', DATE_FORMAT(rh.statusTs, '%Y-%m-%dT%TZ')
            ),        
            'userId', CAST(rh.userId as char),
            'username', ud.username,
            'touchTs', DATE_FORMAT(rh.touchTs, '%Y-%m-%dT%TZ')
    
            )
        ) as history`
  ]

  const joins = [
    'review_history rh',
		'INNER JOIN review rv on rh.reviewId = rv.reviewId',
		'INNER JOIN user_data ud on rh.userId = ud.userId',
    'left join user_data udStatus on udStatus.userId=rh.statusUserId',
		'INNER JOIN result on rh.resultId = result.resultId',
		'INNER JOIN status on rh.statusId = status.statusId',
		'inner join asset a on a.assetId = rv.assetId and a.state = "enabled"'
  ]

  let predicates = {
    statements: ['rv.assetId = a.assetId',
		'a.collectionId = ?'],
    binds: [collectionId] 
  }
  let groupBy = []

  if (startDate) {
   predicates.binds.push(startDate)
   predicates.statements.push('rh.touchTs >= ?')
  }

  if (endDate) {
    predicates.binds.push(endDate)
    predicates.statements.push('rh.touchTs <= ?')
  }

  if(ruleId) {
    predicates.binds.push(ruleId)
    predicates.statements.push('rv.ruleId = ?')
  }

  if(status) {
    predicates. binds.push(dbUtils.REVIEW_STATUS_API[status])
    predicates.statements.push('rh.statusId = ?')
  }

  if(assetId) {
    predicates.binds.push(assetId)
    predicates.statements.push('a.assetId = ?')
  }
  
  groupBy.push('rv.ruleId', 'a.assetId ) innerQuery\nGROUP BY\n innerQuery.assetId')
  let sql = dbUtils.makeQueryString({columns, joins, predicates,groupBy })
  let [rows] = await dbUtils.pool.query(sql, predicates.binds)

  return (rows)
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

  let sql = 'SELECT COUNT(*) as collectionHistoryEntryCount, MIN(rh.touchTs) as oldestHistoryEntryDate'
  
  // If there is a response and the request included the asset projection
  if (projection?.includes('asset')) {
    sql += `, coalesce(
      (SELECT json_arrayagg(
        json_object(
          'assetId', CAST(assetId as char) ,
          'historyEntryCount', historyEntryCount,
          'oldestHistoryEntry', oldestHistoryEntry
          )
        )
        FROM 
        (
          SELECT a.assetId, COUNT(*) as historyEntryCount, MIN(rh.touchTs) as oldestHistoryEntry
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
      INNER JOIN asset a on rv.assetId = a.assetId and a.state = 'enabled'
    WHERE a.collectionId = :collectionId
    additionalPredicates
  `

  let additionalPredicates = ""

  if (startDate) {
    binds.startDate = startDate
    additionalPredicates += " AND rh.touchTs >= :startDate"
  }

  if (endDate) {
    binds.endDate = endDate
    additionalPredicates += " AND rh.touchTs <= :endDate"
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

  let [rows] = await dbUtils.pool.query(sql, binds)
  return (rows[0])
}

exports.getCollectionSettings = async function ( collectionId ) {
  let sql = `
    select
      JSON_MERGE_PATCH('${JSON.stringify(MyController.defaultSettings)}', settings) as settings
    from 
      collection
    where 
      collectionId = ?`
  let [rows] = await dbUtils.pool.query(sql, [collectionId])
  return rows.length > 0 ? rows[0].settings : undefined
}

exports.getCollectionLabels = async function (collectionId, grant) {
  const ctes = []
  const columns = [
    'BIN_TO_UUID(cl.uuid,1) labelId',
    'cl.name',
    'cl.description',
    'cl.color',
    'count(distinct cla.claId) as uses'
  ]
  const joins = [
    'collection_label cl', 
    'left join asset a on cl.collectionId = a.collectionId',
    'left join stig_asset_map sa on a.assetId = sa.assetId',
    'left join collection_label_asset_map cla on cla.clId = cl.clId and cla.assetId = a.assetId and a.state = "enabled"'
  ]
  // const groupBy = [
  //   'cl.uuid',
  //   'cl.name',
  //   'cl.description',
  //   'cl.color'
  // ]
  const groupBy = ['cl.clId']
  const predicates = {
    statements: ['cl.collectionId = ?'],
    binds: [collectionId]
  }
  const orderBy = [
    'cl.name'
  ]
  if (grant.roleId === 1) {
    ctes.push(dbUtils.cteAclEffective({grantIds: grant.grantIds}))
    joins.push('inner join cteAclEffective cae on sa.saId = cae.saId')
  }
  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  const [rows] = await dbUtils.pool.query(sql)
  return rows
}

exports.createCollectionLabel = async function (collectionId, label) {
  let [resultInsert] = await dbUtils.pool.query(
    `INSERT INTO collection_label 
    (collectionId, name, description, color, uuid)
    VALUES (?, ?, ?, ?, UUID_TO_BIN(UUID(),1))`,
  [collectionId, label.name, label.description, label.color])

  const [resultGet] = await dbUtils.pool.query(
    `SELECT BIN_TO_UUID(uuid,1) as uuid from collection_label where clId = ?`,
    [resultInsert.insertId]
  )
  return resultGet[0].uuid
}

exports.getCollectionLabelById = async function (collectionId, labelId, grant) {
  const ctes = []
  const columns = [
    'BIN_TO_UUID(cl.uuid,1) labelId',
    'cl.name',
    'cl.description',
    'cl.color',
    'count(distinct cla.claId) as uses'
  ]
  const joins = [
    'collection_label cl', 
    'left join asset a on cl.collectionId = a.collectionId and a.state = "enabled"',
    'left join stig_asset_map sa on a.assetId = sa.assetId',
    'left join collection_label_asset_map cla on cla.clId = cl.clId and cla.assetId = a.assetId'
  ]
  const predicates = {
    statements: [
      'cl.collectionId = ?',
      'cl.uuid = UUID_TO_BIN(?,1)'
    ],
    binds: [collectionId, labelId]
  }
  const groupBy = ['cl.clId']
  const orderBy = []
  if (grant.roleId === 1) {
    ctes.push(dbUtils.cteAclEffective({grantIds: grant.grantIds}))
    joins.push('inner join cteAclEffective cae on sa.saId = cae.saId')
  }
  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  const [rows] = await dbUtils.pool.query(sql)
  return (rows[0])
}

exports.patchCollectionLabelById = async function (collectionId, labelId, label) {
  const [rows] = await dbUtils.pool.query(
    `UPDATE
      collection_label
    SET
      ?
    WHERE
      collectionId = ?
      and uuid = UUID_TO_BIN(?,1)`,
    [label, collectionId, labelId])
  return rows.affectedRows
}

exports.deleteCollectionLabelById = async function (collectionId, labelId) {
  const [rows] = await dbUtils.pool.query(
    `DELETE FROM
      collection_label
    WHERE
      collectionId = ?
      and uuid = UUID_TO_BIN(?,1)`,
    [collectionId, labelId])
  return rows.affectedRows
}

exports.getAssetsByCollectionLabelId = async function (collectionId, labelId, grant) {
  const ctes = []
  const columns = [
    'CAST(a.assetId as char) as assetId',
    'a.name'
  ]
  const joins = [
    'collection_label cl',
    'left join collection_label_asset_map cla on cla.clId = cl.clId',
    'inner join asset a on cla.assetId = a.assetId and a.state = "enabled"',
  ]
  const predicates = {
    statements: [
      'cl.collectionId = ?',
      'cl.uuid = UUID_TO_BIN(?,1)'
    ],
    binds: [collectionId, labelId]
  }
  const groupBy = []
  const orderBy = ['a.name']
  if (grant.roleId === 1) {
    ctes.push(dbUtils.cteAclEffective({grantIds: grant.grantIds}))
    joins.push(
      'left join stig_asset_map sa on a.assetId = sa.assetId',
      'inner join cteAclEffective cae on sa.saId = cae.saId'
    )
    groupBy.push('a.assetId')
  }
  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  const [rows] = await dbUtils.pool.query(sql)
  return (rows)
}

exports.putAssetsByCollectionLabelId = async function (collectionId, labelId, assetIds, svcStatus = {}) {
  let connection
  try {
    connection = await dbUtils.pool.getConnection()
    async function transaction() {
      await connection.query('START TRANSACTION')

      const sqlGetClId = `select clId from collection_label where uuid = UUID_TO_BIN(?,1)`
      const [clIdRows] = await connection.query( sqlGetClId, [ labelId ] )
      const clId = clIdRows[0].clId
  
      let sqlDelete = `
      DELETE FROM 
        collection_label_asset_map
      WHERE 
        clId = ?`
      if (assetIds.length > 0) {
        sqlDelete += ' and assetId NOT IN ?'
      }  
      await connection.query( sqlDelete, [ clId, [assetIds] ] )
      // Push any bind values
      const binds = []
      for (const assetId of assetIds) {
        binds.push([clId, assetId])
      }
      if (binds.length > 0) {
        let sqlInsert = `
        INSERT IGNORE INTO 
          collection_label_asset_map (clId, assetId)
        VALUES
          ?`
        await connection.query(sqlInsert, [ binds ])
      }
      // Commit the changes
      await connection.commit()
    }
    await dbUtils.retryOnDeadlock(transaction, svcStatus)
  }
  catch (err) {
    if (typeof connection !== 'undefined') {
      await connection.rollback()
    }
    throw err
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.release()
    }
  }
}

exports.getUnreviewedAssetsByCollection = async function (params) {
  return queryUnreviewedByCollection({ grouping: 'asset', ...params})
}

exports.getUnreviewedRulesByCollection = async function (params) {
  return queryUnreviewedByCollection({ grouping: 'rule', ...params})
}

async function queryUnreviewedByCollection ({
  grouping,
  collectionId,
  benchmarkId,
  assetId,
  ruleId,
  severities,
  labelIds,
  labelNames,
  projections,
  grant,
  userObject
}) {
  let columns, groupBy, orderBy
  let projectionMap = []
  switch (grouping) {
    case 'asset':
      columns = [
        'CAST(a.assetId as char) as assetId',
        'a.name',
        `coalesce(
          (select
            json_arrayagg(json_object(
              'labelId', BIN_TO_UUID(cl2.uuid,1),
              'name', cl2.name
              ))
          from
            collection_label_asset_map cla2
            left join collection_label cl2 on cla2.clId = cl2.clId
          where
            cla2.assetId = a.assetId),
          json_array()) as labels`,
        `json_arrayagg(json_object(
          'result', result.api,
          'ruleId', rgr.ruleId,
          'groupId', rgr.groupId,
          ${projections.includes('ruleTitle') ? "'ruleTitle', rgr.title," : ''}
          ${projections.includes('groupTitle') ? "'groupTitle', rgr.title," : ''}
          'severity', rgr.severity,
          'benchmarkId', cr.benchmarkId
        )) as unreviewed`       
      ]
      groupBy = [
        'a.assetId',
        'a.name'
      ]
      orderBy = [
        'a.name'
      ]
      break
    case 'rule':
      projectionMap = projections.map( p => `${p === 'groupTitle' ? 'rgr.groupTitle' : 'rgr.title'}`)
      columns = [
        'rgr.ruleId',
        'rgr.groupId',
        'cr.benchmarkId',
        'rgr.severity',
        ...projectionMap,
        `json_arrayagg(json_object(
          'result', result.api,
          'assetId', CAST(a.assetId as char),
          'name', a.name,
          'labels', coalesce(
            (select
              json_arrayagg(json_object(
                'labelId', BIN_TO_UUID(cl2.uuid,1),
                'name', cl2.name
                ))
            from
              collection_label_asset_map cla2
              left join collection_label cl2 on cla2.clId = cl2.clId
            where
              cla2.assetId = a.assetId),
            json_array())
        )) as unreviewed`
      ]
      groupBy = [
        'rgr.ruleId',
        'rgr.groupId',
        'cr.benchmarkId',
        'rgr.severity',
        ...projectionMap
      ]
      orderBy = [
        'rgr.ruleId'
      ]
  }
  const ctes = []
  const joins = [
    'asset a',
    'left join collection_label_asset_map cla on cla.assetId = a.assetId',
    'left join collection_label cl on cla.clId = cl.clId',
    'left join stig_asset_map sa on a.assetId = sa.assetId',
    'left join current_rev cr on sa.benchmarkId = cr.benchmarkId',
	  'left join rev_group_rule_map rgr on cr.revId = rgr.revId',
    'left join rule_version_check_digest rvcd on rgr.ruleId = rvcd.ruleId',
	  'left join review r on (a.assetId = r.assetId and rvcd.version = r.version and rvcd.checkDigest = r.checkDigest)',
    'left join result on r.resultId = result.resultId'
  ]
  const predicates = {
    statements: [
      'a.collectionId = ?',
      // '(cg.userId = ? AND CASE WHEN cg.roleId = 1 THEN usa.userId = cg.userId ELSE TRUE END)',
      '(r.reviewId is null or r.resultId not in (2,3,4))',
    ],
    binds: [collectionId, userObject.userId]
  }
  if (assetId) {
    predicates.statements.push('a.assetId = ?')
    predicates.binds.push(assetId)
  }
  if (labelIds?.length) {
    predicates.statements.push('cl.uuid IN ?')
    const uuidBinds = labelIds.map( uuid => dbUtils.uuidToSqlString(uuid))
    predicates.binds.push([uuidBinds])
  }
  if (labelNames?.length) {
    predicates.statements.push('cl.name IN ?')
    predicates.binds.push([labelNames])
  }
  if (benchmarkId) {
    predicates.statements.push('cr.benchmarkId = ?')
    predicates.binds.push(benchmarkId)
  }
  if (ruleId) {
    predicates.statements.push('rgr.ruleId = ?')
    predicates.binds.push(ruleId)
  }
  if (severities?.length) {
    predicates.statements.push('rgr.severity IN ?')
    predicates.binds.push([severities])
  }
  if (grant.roleId === 1) {
    ctes.push(dbUtils.cteAclEffective({grantIds: grant.grantIds}))
    joins.push('inner join cteAclEffective cae on sa.saId = cae.saId')
  }

  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  let [rows] = await dbUtils.pool.query(sql)
  return (rows)
}

exports.writeStigPropsByCollectionStig = async function ({collectionId, benchmarkId, defaultRevisionStr, assetIds, svcStatus = {}}) {
  let connection
  try {
    let version, release
    if (defaultRevisionStr) {
      if (defaultRevisionStr !== 'latest') {
        ;({version, release} = dbUtils.parseRevisionStr(defaultRevisionStr))
      }
    }
    connection = await dbUtils.pool.getConnection()
    await dbUtils.retryOnDeadlock(transaction, svcStatus)
  
    async function transaction () {
      await connection.query('START TRANSACTION')
      if (defaultRevisionStr === 'latest' || assetIds?.length === 0) {
        await connection.query('DELETE FROM collection_rev_map WHERE collectionId = ? and benchmarkId = ?', [collectionId, benchmarkId])
      }
      else if (defaultRevisionStr && defaultRevisionStr !== 'latest') {
        const [revisions] = await connection.query('SELECT revId FROM revision WHERE benchmarkId = ? and `version` = ? and `release` = ?', [benchmarkId, version, release])
        if (revisions[0]?.revId) {
          await connection.query(`INSERT INTO collection_rev_map (collectionId, benchmarkId, revId)
          VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE revId = new.revId`, [collectionId, benchmarkId, revisions[0].revId])
        }
      }  
      if (assetIds) {
        let sqlDeleteStigAsset = `
        DELETE stig_asset_map FROM 
          stig_asset_map
          left join asset on stig_asset_map.assetId = asset.assetId
        WHERE
          asset.collectionId = ?
          and stig_asset_map.benchmarkId = ?${assetIds.length > 0 ? ' and stig_asset_map.assetId NOT IN ?': ''}`
        
        // DELETE from stig_asset_map, which will cascade into user_stig_aset_map
        await connection.query( sqlDeleteStigAsset, [ collectionId, benchmarkId, [assetIds] ] )
        
        if (assetIds.length) {
          const binds = assetIds.map( assetId => [benchmarkId, assetId])
          // INSERT into stig_asset_map
          const sqlInsertBenchmarks = `INSERT IGNORE INTO stig_asset_map (benchmarkId, assetId) VALUES ?`
          await connection.query(sqlInsertBenchmarks, [ binds ])
        }
      }
      await dbUtils.updateDefaultRev(connection, {collectionId, benchmarkId})
      await dbUtils.updateStatsAssetStig(connection, {collectionId, benchmarkId})
      await connection.commit()
    }  
  }
  catch (err) {
    if (typeof connection !== 'undefined') {
      await connection.rollback()
    }
    throw ( err )
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.release()
    }
  }
}

exports.doesCollectionIncludeAssets = async function ({collectionId, assetIds}) {
  try {
    const sql = `select jt.assetId, a.collectionId
    from 
    JSON_TABLE(
      ?,
      "$[*]"
      COLUMNS(
        assetId INT(11) PATH "$"
      ) ) AS jt
    left join asset a using (assetId)
    where a.collectionId != ? or a.collectionId is null or a.state != "enabled"`

    const [rows] = await dbUtils.pool.query(sql, [JSON.stringify(assetIds), collectionId])
    return rows.length === 0
  }
  catch (e) {
    return false
  }
}

exports.doesCollectionIncludeStig = async function ({collectionId, benchmarkId}) {
  try {
    const [rows] = await dbUtils.pool.query(
      `select distinct sam.benchmarkId from asset a inner join stig_asset_map sam using (assetId) where a.collectionId = ? and a.state = "enabled"`,
      [collectionId]
    )
    return rows.some(i => i.benchmarkId === benchmarkId)
  }
  catch (e) {
    return false
  }
}

exports.cloneCollection = async function ({collectionId, userObject, name, description, options, svcStatus = {}, progressCb = () => {}}) {
  let connection, progressJson
  try {
    const sql = {
      cloneCollection: {
        query: `INSERT INTO collection (name, description, settings, metadata, state) SELECT @name,@description,settings, metadata, "cloning" from collection WHERE collectionId = @srcCollectionId`,
        startText: 'Creating core properties',
        finishText: 'Creating core properties'
      },
      selectLastInsertId: {
        query: 'SELECT last_insert_id() into @destCollectionId',
        startText: 'Creating core properties',
        finishText: 'Created core properties'
      },
      cloneGrants: {
        query: `INSERT INTO collection_grant (collectionId, userId, userGroupId, roleId) SELECT @destCollectionId, userId, userGroupId, roleId FROM collection_grant where collectionId = @srcCollectionId`,
        startText: 'Creating Grants',
        finishText: 'Creating Grants'
      },
      dropGrantMap: {
        query: `DROP TEMPORARY TABLE IF EXISTS t_grantid_map`,
        startText: 'Creating Grants',
        finishText: 'Creating Grants'
      },
      createGrantMap: {
        query: `CREATE TEMPORARY TABLE t_grantid_map SELECT cg1.grantId as srcGrantId, cg2.grantId as destGrantId FROM collection_grant cg1 left join collection_grant cg2 on (cg1.collectionId = @srcCollectionId and (cg1.userId = cg2.userId or cg1.userGroupId = cg2.userGroupId) and cg1.roleId = cg2.roleId) WHERE cg2.collectionId = @destCollectionId`,
        startText: 'Creating Grants',
        finishText: 'Creating Grants'
      },
      insertOwnerGrant: {
        query: `INSERT INTO collection_grant (collectionId, userId, roleId) VALUES (@destCollectionId, @userId, 4) ON DUPLICATE KEY UPDATE roleId = 4`,
        startText: 'Creating Grants',
        finishText: 'Created Grants'
      },
      cloneLabels: {
        query: `INSERT INTO collection_label (collectionId, name, description, color, uuid) SELECT @destCollectionId,name,description,color,UUID_TO_BIN(UUID(),1) FROM collection_label where collectionId = @srcCollectionId`,
        startText: 'Creating Labels',
        finishText: 'Created Labels'
      },
      cloneAssets: {
        query: `INSERT INTO asset (name, fqdn, collectionId, ip, mac, description, noncomputing, metadata) SELECT name,fqdn,@destCollectionId,ip,mac,description,noncomputing,metadata from asset where state = "enabled" and collectionId = @srcCollectionId`,
        startText: 'Creating Assets',
        finishText: 'Creating Assets'
      },
      dropAssetMap: {
        query: `DROP TEMPORARY TABLE IF EXISTS t_assetid_map`,
        startText: 'Creating Assets',
        finishText: 'Creating Assets'
      },
      createAssetMap: {
        query: `CREATE TEMPORARY TABLE t_assetid_map SELECT a1.assetId as srcAssetId, a2.assetId as destAssetId FROM asset a1 left join asset a2 on (a1.collectionId =  @srcCollectionId and a1.name = a2.name and a1.state = "enabled") WHERE a2.collectionId = @destCollectionId`,
        startText: 'Creating Assets',
        finishText: 'Created Assets'
      },
      dropLabelMap: {
        query: `DROP TEMPORARY TABLE IF EXISTS t_clid_map`,
        startText: 'Creating Asset/Label mappings',
        finishText: 'Creating Asset/Label mappings'
      },
      createLabelMap: {
        query: `CREATE TEMPORARY TABLE t_clid_map SELECT cl1.clId as srcClId, cl2.clId as destClId FROM collection_label cl1 left join collection_label cl2 on (cl1.collectionId = @srcCollectionId and cl1.name = cl2.name) WHERE cl2.collectionId = @destCollectionId`,
        startText: 'Creating Asset/Label mappings',
        finishText: 'Creating Asset/Label mappings'
      },
      cloneAssetLabels: {
        query: `INSERT INTO collection_label_asset_map (assetId, clId) SELECT am.destAssetId,cm.destClId FROM collection_label_asset_map cla INNER JOIN t_clid_map cm on cla.clId = cm.srcClId INNER JOIN t_assetid_map am on cla.assetId = am.srcAssetId`,
        startText: 'Creating Asset/Label mappings',
        finishText: 'Created Asset/Label mappings'
      },
      cloneStigMappingsWithReviews: {
        query: `INSERT INTO stig_asset_map (benchmarkId, assetId, minTs, maxTs, saved, savedResultEngine, submitted, submittedResultEngine, rejected, rejectedResultEngine, accepted, acceptedResultEngine, highCount, mediumCount, lowCount, notchecked, notcheckedResultEngine, notapplicable, notapplicableResultEngine, pass, passResultEngine, fail, failResultEngine, unknown, unknownResultEngine, error, errorResultEngine, notselected, notselectedResultEngine, informational, informationalResultEngine, fixed, fixedResultEngine, maxTouchTs) SELECT benchmarkId, am.destAssetId, minTs, maxTs, saved, savedResultEngine, submitted, submittedResultEngine, rejected, rejectedResultEngine, accepted, acceptedResultEngine, highCount, mediumCount, lowCount, notchecked, notcheckedResultEngine, notapplicable, notapplicableResultEngine, pass, passResultEngine, fail, failResultEngine, unknown, unknownResultEngine, error, errorResultEngine, notselected, notselectedResultEngine, informational, informationalResultEngine, fixed, fixedResultEngine, maxTouchTs FROM stig_asset_map sa INNER JOIN t_assetid_map am on sa.assetId = am.srcAssetId`,
        startText: 'Creating Asset/STIG mappings with Metrics',
        finishText: 'Created Asset/STIG mappings with Metrics'
      },
      cloneStigMappingsWithoutReviews: {
        query: `INSERT INTO stig_asset_map (benchmarkId, assetId) SELECT benchmarkId, am.destAssetId FROM stig_asset_map sa INNER JOIN t_assetid_map am on sa.assetId = am.srcAssetId`,
        startText: 'Creating Asset/STIG mappings',
        finishText: 'Created Asset/STIG mappings'
      },
      cloneGrantAcls: {
        query: `INSERT INTO collection_grant_acl (grantId, benchmarkId, assetId, clId, access)
        SELECT
          gm.destGrantId,
          cg1.benchmarkId,
          am.destAssetId,
          cm.destClId,
          cg1.access
        FROM
          collection_grant_acl cg1
          inner join t_grantid_map gm on cg1.grantId = gm.srcGrantId
          left join t_assetid_map am on cg1.assetId = am.srcAssetId 
          left join t_clid_map cm on cg1.clId = cm.srcClId`,
          startText: 'Creating Collection Grant ACLs',
          finishText: 'Created Collection Grant ACLs'
      },
      cloneRevisionsMatchSource: {
        query: `INSERT INTO collection_rev_map (collectionId, benchmarkId, revId) SELECT @destCollectionId, benchmarkId, revId FROM collection_rev_map where collectionId = @srcCollectionId`,
        startText: 'Creating Revision pins',
        finishText: 'Creating Revision pins'
      },
      cloneRevisionsSourceDefaults: {
        query: `INSERT INTO collection_rev_map (collectionId, benchmarkId, revId) SELECT @destCollectionId, benchmarkId, revId FROM default_rev where collectionId = @srcCollectionId`,
        startText: 'Creating Revision pins',
        finishText: 'Creating Revision pins'
      },
      insertDefaultRev: {
        query: `INSERT INTO default_rev(collectionId, benchmarkId, revId, revisionPinned) SELECT collectionId, benchmarkId, revId, revisionPinned FROM v_default_rev WHERE collectionId = @destCollectionId`,
        startText: 'Creating Revision pins',
        finishText: 'Created Revision pins'
      },

      countReviewIds: {
        query: `SELECT count(seq) as reviewCount from t_reviewId_list`,
        startText: 'Creating Reviews',
        finishText: 'Creating Reviews'
      },
      dropReviewIdList: {
        query: `DROP TEMPORARY TABLE IF EXISTS t_reviewId_list`,
        startText: 'Creating Reviews',
        finishText: 'Creating Reviews'
      },
      createReviewIdList: {
        query: `CREATE TEMPORARY TABLE t_reviewId_list (seq INT AUTO_INCREMENT PRIMARY KEY)
      SELECT r.reviewId, am.destAssetId FROM asset a inner join t_assetid_map am on a.assetId = am.srcAssetId inner join review r on am.srcAssetId = r.assetId `,
      startText: 'Creating Reviews',
      finishText: 'Creating Reviews'
      },
      
      cloneReviews: {
        query: `INSERT INTO review (assetId, ruleId, resultId, detail, comment, autoResult, ts, userId, statusId, statusText, statusUserId, statusTs, metadata, resultEngine, version, checkDigest)
        SELECT rl.destAssetId, r.ruleId, r.resultId, r.detail, r.comment, r.autoResult, r.ts, r.userId, r.statusId, r.statusText, r.statusUserId, r.statusTs, r.metadata, r.resultEngine, r.version, r.checkDigest
        FROM
        t_reviewId_list rl
        left join review r using (reviewId)
        WHERE
        rl.seq >= ? and rl.seq <= ?`,
        startText: 'Creating Reviews',
        finishText: 'Created Reviews'
      },

      enableCollection: `UPDATE collection SET state = "enabled" WHERE collectionId = @destCollectionId`
    }

    connection = await dbUtils.pool.getConnection()
    connection.config.namedPlaceholders = false
    connection.query('set @srcCollectionId = ?, @userId = ?, @name = ?, @description = ?', [
      parseInt(collectionId),
      parseInt(userObject.userId),
      name,
      description
    ])

    const collectionQueries = ['cloneCollection', 'selectLastInsertId']
    const reviewQueries = []

    if (options.grants) {
      collectionQueries.push('cloneGrants', 'dropGrantMap', 'createGrantMap')
    }
    collectionQueries.push('insertOwnerGrant')

    if (options.labels) {
      collectionQueries.push('cloneLabels')
    }

    if (options.assets) {
      collectionQueries.push('cloneAssets', 'dropAssetMap', 'createAssetMap')
      if (options.labels) {
        collectionQueries.push('dropLabelMap', 'createLabelMap', 'cloneAssetLabels')
      }
      if (options.stigMappings !== 'none') {
        collectionQueries.push(options.stigMappings === 'withReviews' ? 'cloneStigMappingsWithReviews' : 'cloneStigMappingsWithoutReviews')
        if (options.grants) {
          collectionQueries.push('cloneGrantAcls')
          // collectionQueries.push('cloneRestrictedUserGroupGrants')
        }
        collectionQueries.push(options.pinRevisions === 'matchSource' ? 'cloneRevisionsMatchSource' : 'cloneRevisionsSourceDefaults')
        collectionQueries.push('insertDefaultRev')
      }
      if (options.stigMappings === 'withReviews') {
        reviewQueries.push('dropReviewIdList', 'createReviewIdList', 'cloneReviews')
      }
    }

    async function transactionCollection () {
      const stage = 'collection'
      const stepCount = collectionQueries.length + 1
      progressJson = {stage, stepCount, step: 0}

      await connection.query('START TRANSACTION')

      for (const query of collectionQueries) {
        progressJson.step++
        progressJson.stepName = query
        progressJson.status = 'running'
        progressJson.message = sql[query].startText
        progressCb(progressJson) 

        await connection.query(sql[query].query)
      }

      progressJson.step++
      progressJson.stepName = 'commit'
      progressJson.status = 'running'
      progressJson.message = 'Saving Collection'
      progressCb(progressJson) 

      await connection.commit()

      progressJson.status = 'finished'
      progressJson.message = 'Saved Collection'
      progressCb(progressJson) 
    }

    async function transactionReviews () {
      const stage = 'reviews'
      const stepCount = reviewQueries.length + 1
      progressJson = {stage, stepCount, step: 0}

      await connection.query('START TRANSACTION')
      for (const query of reviewQueries) {
        progressJson.stepName = query
        progressJson.step++
        progressJson.message = sql[query].startText

        if (query === 'cloneReviews') {
          let offset = 1
          const chunkSize = 10000

          let [result] = await connection.query(sql.countReviewIds.query)

          progressJson.status = 'running'
          progressJson.reviewsTotal = result[0].reviewCount
          progressJson.reviewsCopied = 0
          progressCb(progressJson) 

          do {
            [result] = await connection.query(sql[query].query, [offset, offset + chunkSize - 1])
            if (result.affectedRows != 0) {
              progressJson.reviewsCopied += result.affectedRows
              progressCb(progressJson) 
            }
            offset += chunkSize
          } while (result.affectedRows != 0)
        }
        else {
          progressJson.status = 'running'
          progressCb(progressJson)
          await connection.query(sql[query].query)
        }
      }
      progressJson.step++
      progressJson.stepName = 'commit'
      progressJson.status = 'running'
      progressCb(progressJson) 

      await connection.commit()

      progressJson.status = 'finished'
      progressCb(progressJson) 
    }

    await dbUtils.retryOnDeadlock(transactionCollection, svcStatus)
    await dbUtils.retryOnDeadlock(transactionReviews, svcStatus)
    await connection.query(sql.enableCollection)
    const [rows] = await connection.query(`SELECT @destCollectionId as destCollectionId`)
    return rows[0]
  }
  catch (err) {
    if (typeof connection !== 'undefined') {
      await connection.rollback()
    }
    progressJson.status = 'error'
    if (err.message.match(/Duplicate entry .* for key 'collection.index[2|3]'/)) {
      progressJson.message = 'The requested Collection name is unavailable'
    }
    else {
      progressJson.message = 'Unhandled error'
      progressJson.error = err
      progressJson.stack = err?.stack
    }
    progressCb(progressJson)
    return null
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.release()
    }
  }
}

exports.exportToCollection = async function ({srcCollectionId, dstCollectionId, assetStigArguments, userObject, svcStatus = {}, progressCb = () => {}}) {
  let connection, progressJson
  try {
    const sql = {
      dropArg: {
        query: `drop temporary table if exists t_arg`,
        runningText: 'Preparing data'
      },
      createArg: {
        query: `create temporary table t_arg (
          assetId INT,
          assetName VARCHAR(255),
          benchmarkId VARCHAR(255),
          revisionStr VARCHAR(255),
          UNIQUE INDEX (assetId, benchmarkId, revisionStr),
          INDEX (assetName)
        )
        select * from
        json_table(
          @json, 
          "$[*]"
          COLUMNS(
          assetId INT path "$.assetId",
            assetName VARCHAR(255) path "$.assetName",
            nested path "$.stigs[*]" COLUMNS(
              benchmarkId VARCHAR(255) path "$.benchmarkId",
              revisionStr VARCHAR(255) path "$.revisionStr"
            )
          )
        ) as arg`,
        runningText: 'Preparing data'
      },
      dropCollectionSetting: {
        query: `drop temporary table if exists t_collection_setting`,
        runningText: 'Preparing data'
      },
      createCollectionSetting: {
        query: `create temporary table t_collection_setting
        SELECT 
          c.settings->>"$.fields.detail.required" as detailRequired,
          c.settings->>"$.fields.comment.required" as commentRequired,
          c.settings->>"$.status.canAccept" as canAccept,
          c.settings->>"$.status.resetCriteria" as resetCriteria,
          c.settings->>"$.status.minAcceptGrant" as minAcceptGrant,
          c.settings->>"$.history.maxReviews" as historyMax
        FROM
          collection c
        where
          collectionId = @dstCollectionId`,
          runningText: 'Preparing data'
      },
      dropSrcReviewId: {
        query: `drop temporary table if exists t_src_reviewId`,
        runningText: 'Preparing data'
      },
      createSrcReviewId: {
        query: `create temporary table t_src_reviewId (seq INT AUTO_INCREMENT PRIMARY KEY, reviewId INT UNIQUE )
        select
          r.reviewId
        from
          t_arg
          left join revision rev on (t_arg.benchmarkId collate utf8mb4_0900_as_cs = rev.benchmarkId and t_arg.revisionStr = rev.revisionStr)
          left join rev_group_rule_map rgr on (rev.revId = rgr.revId)
          left join rule_version_check_digest rvcd on rgr.ruleId = rvcd.ruleId
          inner join review r on (rvcd.version = r.version and rvcd.checkDigest = r.checkDigest and t_arg.assetId = r.assetId)`,
          runningText: 'Preparing data'
      },
      countSrcReviewId: {
        query: `select count(*) as total from t_src_reviewId`,
        runningText: 'Preparing data'
      },
      insertAsset: {
        query: `INSERT into asset (name, fqdn, collectionId, ip, mac, description, noncomputing, metadata, state, stateDate, stateUserId)
        SELECT
          srcAsset.name,
          srcAsset.fqdn,
          @dstCollectionId,
          srcAsset.ip,
          srcAsset.mac,
          srcAsset.description,
          srcAsset.noncomputing,
          srcAsset.metadata,
          'enabled',
          NOW(),
          @userId
        FROM
          t_arg
          left join asset srcAsset on (t_arg.assetId = srcAsset.assetId and srcAsset.isEnabled = 1)
          left join asset dstAsset on (t_arg.assetName = dstAsset.name and dstAsset.collectionId = @dstCollectionId and dstAsset.isEnabled = 1)
        WHERE
          dstAsset.assetId is null
        GROUP BY
          t_arg.assetId`,
        runningText: "Preparing Assets"
      },
      dropAssetIdMap: {
        query: `drop temporary table if exists t_assetId_map`,
        runningText: "Preparing Assets"
      },
      createAssetIdMap: {
        query: `create temporary table t_assetId_map (
          srcAssetId INT,
          dstAssetId INT,
          INDEX (srcAssetId),
          INDEX (dstAssetId)
        )
        select
          srcAsset.assetId as srcAssetId,
          dstAsset.assetId as dstAssetId
        from
          t_arg
          inner join asset srcAsset on (t_arg.assetId = srcAsset.assetId)
          inner join asset dstAsset on (t_arg.assetName = dstAsset.name and dstAsset.collectionId = @dstCollectionId)
        group by
          srcAsset.assetId, dstAsset.assetId`,
          runningText: "Preparing Assets"
      },
      insertStigAssetMap: {
        query: `INSERT into stig_asset_map (assetId, benchmarkId)
        select
          a.assetId,
          t_arg.benchmarkId
        from
          t_arg
          left join asset a on (t_arg.assetName = a.name and a.collectionId = @dstCollectionId and a.isEnabled = 1)
          left join stig_asset_map sa on (t_arg.benchmarkId collate utf8mb4_0900_as_cs = sa.benchmarkId and a.assetId = sa.assetId)
        where
          sa.saId is null`,
          runningText: "Preparing Assets"
      },
      selectStigAssetMap: {
        query: `select
          sa.saId
        from
          t_arg
          left join asset a on (t_arg.assetName = a.name and a.collectionId = @dstCollectionId and a.isEnabled = 1)
          left join stig_asset_map sa on (t_arg.benchmarkId collate utf8mb4_0900_as_cs = sa.benchmarkId and a.assetId = sa.assetId)`
      },
      deleteDefaultRev: {
        query: `DELETE FROM default_rev where collectionId = @dstCollectionId`,
        runningText: "Preparing Assets"
      },
      insertDefaultRev: {
        query: `INSERT INTO default_rev(collectionId, benchmarkId, revId, revisionPinned) SELECT collectionId, benchmarkId, revId, revisionPinned FROM v_default_rev where collectionId = @dstCollectionId`,
        finishText: 'Created Asset/STIG maps',
        runningText: "Preparing Assets"
      },
      dropIncomingReview: {
        query: `drop temporary table if exists t_incoming_review`,
        runningText: `Preparing reviews`,
        finishText: `Preparing reviews`
      },
      createIncomingReview: {
        query: `create temporary table t_incoming_review
        select
          dstReview.reviewId,
          t_assetId_map.dstAssetId as assetId,
          srcReview.version,
          srcReview.checkDigest,
          srcReview.ruleId,
          srcReview.resultId,
          srcReview.detail, 
          srcReview.comment, 
          srcReview.resultEngine, 
          srcReview.metadata,
          UTC_TIMESTAMP() as ts,
          @userId as userId,
          CASE WHEN dstReview.reviewId is null or rStatusReset.reviewId is not null
            THEN 0
            ELSE dstReview.statusId
          END as statusId,	
          CASE WHEN dstReview.reviewId is null
            THEN ''
            ELSE
              CASE WHEN rStatusReset.reviewId is not null
                THEN 'Status reset due to a Review change or Collection setting'
                ELSE dstReview.statusText
            END
          END as statusText,	
          CASE WHEN dstReview.reviewId is null or rStatusReset.reviewId is not null
            THEN UTC_TIMESTAMP()
          ELSE dstReview.statusTs
          END as statusTs,	
          CASE WHEN dstReview.reviewId is null or rStatusReset.reviewId is not null
            THEN @userId
          ELSE dstReview.statusUserId
           END as statusUserId	
        from
          t_src_reviewId
          left join t_collection_setting on true
          inner join review srcReview on (t_src_reviewId.reviewId = srcReview.reviewId)
          left join t_assetId_map on (srcReview.assetId = t_assetId_map.srcAssetId)
          left join review dstReview on (srcReview.version = dstReview.version and srcReview.checkDigest = dstReview.checkDigest and t_assetId_map.dstAssetId = dstReview.assetId) 
          left join review rChangedResult on (
            dstReview.reviewId = rChangedResult.reviewId 
            and 0 != rChangedResult.statusId
            and srcReview.resultId != rChangedResult.resultId
          )
          left join review rChangedAny on (
            dstReview.reviewId  = rChangedAny.reviewId 
            and 0 != rChangedAny.statusId
            and (srcReview.resultId != rChangedAny.resultId or srcReview.detail != rChangedAny.detail or srcReview.comment != rChangedAny.comment)
          )
          left join review rStatusReset on (
            dstReview.reviewId = rStatusReset.reviewId and (
              (t_collection_setting.resetCriteria = 'result' and rChangedResult.reviewId is not null)
            or (t_collection_setting.resetCriteria = 'any' and rChangedAny.reviewId is not null)
            or (t_collection_setting.detailRequired = 'always' and srcReview.detail = '')
            or (t_collection_setting.commentRequired = 'always' and srcReview.comment = '')
            or (t_collection_setting.detailRequired = 'findings' and srcReview.resultId = 4 and srcReview.detail = '')
            or (t_collection_setting.commentRequired = 'findings' and srcReview.resultId = 4 and srcReview.comment = '')
            )
          )
        where
          t_src_reviewId.seq >= ? and t_src_reviewId.seq <= ?`,
        runningText: `Preparing reviews`,
        finishText: `Preparing reviews`
      },
      countIncomingReview: {
        query: `select sum(reviewId is null) as inserted, sum(reviewId is not null) as updated from t_incoming_review`,
        runningText: `Preparing reviews`,

      },
      pruneHistory: {
        query: `with historyRecs AS (
          select
            rh.historyId,
            ROW_NUMBER() OVER (PARTITION BY r.assetId, r.version, r.checkDigest ORDER BY rh.historyId DESC) as rowNum
          from
            review_history rh
            inner join t_incoming_review r using (reviewId)
          )
        delete review_history
        FROM 
           review_history
           left join historyRecs on review_history.historyId = historyRecs.historyId 
        WHERE 
           historyRecs.rowNum > ((select historyMax from t_collection_setting) - 1)`,
           runningText: `Preparing reviews`,
           finishText: `Preparing reviews`
      },
      insertHistory: {
        query: `INSERT INTO review_history (
            reviewId,
            ruleId,
            resultId,
            detail,
            comment,
            autoResult,
            ts,
            userId,
            statusText,
            statusUserId,
            statusTs,
            statusId,
            touchTs,
            resultEngine)
          SELECT 
            r.reviewId,
            r.ruleId,
            r.resultId,
            LEFT(r.detail,32767) as detail,
            LEFT(r.comment,32767) as comment,
            r.autoResult,
            r.ts,
            r.userId,
            r.statusText,
            r.statusUserId,
            r.statusTs,
            r.statusId,
            r.touchTs,
            r.resultEngine
          FROM
            review r
            inner join t_incoming_review using (reviewId)`,
          runningText: `Preparing reviews`,
          finishText: `Prepared reviews`
      },
      upsertReview: {
        query: `insert into review (reviewId, assetId, version, checkDigest, ruleId, resultId, detail, comment, resultEngine, metadata, ts, userId, statusId, statusText, statusTs, statusUserId)
        select * from t_incoming_review as r
        on duplicate key update
          ruleId = r.ruleId,
          resultId = r.resultId,
          detail = r.detail,
          comment = r.comment,
          ts = r.ts,
          userId = r.userId,
          statusId = r.statusId,
          statusText = r.statusText,
          statusUserId = r.statusUserId,
          statusTs = r.statusTs,
          metadata = r.metadata,
          resultEngine = r.resultEngine`
      }
    }
    connection = await dbUtils.pool.getConnection()
    connection.config.namedPlaceholders = false
    connection.query('set @srcCollectionId = ?, @dstCollectionId = ?, @userId = ?, @json = ?',
    [parseInt(srcCollectionId), parseInt(dstCollectionId), parseInt(userObject.userId), JSON.stringify(assetStigArguments)])
    const prepQueries = ['dropArg', 'createArg', 'dropCollectionSetting', 'createCollectionSetting', 'dropSrcReviewId', 'createSrcReviewId']
    const assetQueries = ['insertAsset', 'dropAssetIdMap', 'createAssetIdMap', 'insertStigAssetMap', 'deleteDefaultRev', 'insertDefaultRev']
    const reviewExportQueries = ['pruneHistory', 'insertHistory', 'upsertReview']
    const counts = {
      assetsCreated: 0,
      stigsMapped: 0,
      reviewsInserted: 0,
      reviewsUpdated: 0
    }

    async function transaction () {
      progressJson = {
        stage: 'prepare',
        stepCount: prepQueries.length,
        step: 0
      }

      await connection.query('START TRANSACTION')
      for (const query of prepQueries) {
        progressJson.step++
        progressJson.stepName = query
        progressJson.status = 'running'
        progressJson.message = sql[query].runningText
        progressCb(progressJson) 
        await connection.query(sql[query].query)
      }

      progressJson.stage = 'assets'
      progressJson.stepCount = assetQueries.length
      progressJson.step = 0
      for (const query of assetQueries) {
        progressJson.step++
        progressJson.stepName = query
        progressJson.status = 'running'
        progressJson.message = sql[query].runningText
        progressCb(progressJson)

        const [result] = await connection.query(sql[query].query)
        if (query === 'insertAsset') {
          counts.assetsCreated = result.affectedRows
        }
        if (query === 'insertStigAssetMap') {
          counts.stigsMapped = result.affectedRows
        }
      }

      const [count] = await connection.query(sql.countSrcReviewId.query)
      let offset = 1
      const chunkSize = 10000
      let result

      progressJson = {
        stage: 'reviews',
        status: 'running',
        reviewsTotal: count[0].total,
        reviewsExported: 0
      }
      progressCb(progressJson)
      do {
        await connection.query(sql.dropIncomingReview.query)
        ;[result] = await connection.query(sql.createIncomingReview.query, [offset, offset + chunkSize - 1])
        if (result.affectedRows != 0) {
          const [count] = await connection.query(sql.countIncomingReview.query)
          counts.reviewsInserted += count[0].inserted
          counts.reviewsUpdated += count[0].updated
          for (const query of reviewExportQueries) {
            await connection.query(sql[query].query)
          }
          progressJson.reviewsExported += result.affectedRows
          progressCb(progressJson) 
        }
        offset += chunkSize
      } while (result.affectedRows != 0)

      const [saIdResult]  = await connection.query(sql.selectStigAssetMap.query)
      progressJson = {
        stage: 'metrics',
        status: 'running',
        metricsTotal: saIdResult.length,
        metricsUpdated: 0
      }
      progressCb(progressJson)
      const increment = 1000
      for (let i = 0; i < saIdResult.length; i+=increment) {
        const saIds = saIdResult.slice(i, i + increment).map(row => row.saId)
        await dbUtils.updateStatsAssetStig(connection, {saIds})
        progressJson.metricsUpdated += saIds.length
        progressCb(progressJson)
      }

      progressJson = {
        stage: 'commit',
        status: 'running'
      }
      progressCb(progressJson) 
      await connection.commit()

      progressCb({
        stage: 'result',
        counts
      }) 
    }
    await dbUtils.retryOnDeadlock(transaction, svcStatus)
  }
  catch (err) {
    if (typeof connection !== 'undefined') {
      await connection.rollback()
    }
    progressJson.status = 'error'
    progressJson.message = 'Unhandled error'
    progressJson.error = err
    progressJson.stack = err?.stack
    progressCb({progressJson})
    return null
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.release()
    }
  }
}

exports.setGrantByCollection = async function ({collectionId, userId, userGroupId, roleId}) {

  const sqlInsertGrant = 
  `INSERT INTO collection_grant (collectionId, ${userId ? 'userId' : 'userGroupId'}, roleId) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE roleId = new.roleId`

  const [response] = await dbUtils.pool.query(sqlInsertGrant, [collectionId, userId || userGroupId, roleId])
  // resolving if we are inserting a new db record or updating an existing.
  const httpStatus = (response.affectedRows === 1 && response.insertId !== 0) ? 201 : 200
  return httpStatus
}

exports.getEffectiveAclByCollectionUser = async function ({collectionId, userId}) {
  const sqlSelectEffectiveGrants = `
with cteGrantees as (
select 
	  json_array(cg.grantId) as grantIds
  from
    collection_grant cg
    inner join collection c on (cg.collectionId = c.collectionId and c.state = 'enabled')
    left join user_data ud on cg.userId = ud.userId
where
	cg.userId is not null
    and cg.collectionId = ?
    and cg.userId = ?
union 
  select
    grantIds
  from
    (
    select
      ROW_NUMBER() OVER(PARTITION BY ugu.userId, cg.collectionId ORDER BY cg.roleId desc) as rn,
      json_arrayagg(cg.grantId) OVER (PARTITION BY ugu.userId, cg.collectionId, cg.roleId) as grantIds
    from 
      collection_grant cg
      left join user_group_user_map ugu on cg.userGroupId = ugu.userGroupId
      left join user_group ug on ugu.userGroupId = ug.userGroupId
      left join collection_grant cgDirect on (cg.collectionId = cgDirect.collectionId and ugu.userId = cgDirect.userId)
      inner join collection c on (cg.collectionId = c.collectionId and c.state = 'enabled')
    where
    cg.userGroupId is not null
    and cgDirect.userId is null
	and cg.collectionId = ?
    and ugu.userId = ?
    ) dt
  where
    dt.rn = 1
),
cteAclRules as (select 
	sa.saId,
	sa.assetId,
	sa.benchmarkId,
    cga.grantId,
	cga.access,
    json_object('assetId', cast(a.assetId as char), 'name', a.name) as asset,
    json_object(
		'grantee', json_remove(json_object(
			CASE WHEN ud.userId is null THEN 'x' ELSE 'userId' END, CAST(ud.userId AS CHAR),
			CASE WHEN ud.userId is null THEN 'x' ELSE 'username' END, ud.username,
			CASE WHEN ug.userGroupId is null THEN 'x' ELSE 'userGroupId' END, CAST(ug.userGroupId AS CHAR),
			CASE WHEN ug.userGroupId is null THEN 'x' ELSE 'name' END, ug.name,
            'roleId', cg.roleId
			), '$.x'),
		'aclRule', json_remove(json_object(
			CASE WHEN cga.benchmarkId is null THEN 'x' ELSE 'benchmarkId' END, cga.benchmarkId,
			CASE WHEN cga.assetId is null THEN 'x' ELSE 'asset' END, 
			CASE WHEN cga.assetId is null THEN NULL ELSE json_object('assetId', cast(cga.assetId as char), 'name', a.name) END,
			CASE WHEN cga.clId is null THEN 'x' ELSE 'label' END,
			CASE WHEN cga.clId is null THEN NULL ELSE json_object('labelId', BIN_TO_UUID(cl.uuid,1), 'name', cl.name) END,
			'access', cga.access
		), '$.x')
	) as aclSource,
	case when cga.benchmarkId is not null then 1 else 0 end +
	  case when cga.assetId is not null then 1 else 0 end +
	  case when cga.assetId is not null and cga.benchmarkId is not null then 1 else 0 end +
	  case when cga.clId is not null then 1 else 0 end as specificity
from
	collection_grant_acl cga
    left join collection_grant cg on cga.grantId = cg.grantId
    left join user_data ud on cg.userId = ud.userId
    left join user_group ug on cg.userGroupId = ug.userGroupId
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
	cga.grantId in (
		select /*+ NO_MERGE() */ jt.grantId from cteGrantees left join json_table (cteGrantees.grantIds, '$[*]' COLUMNS (grantId INT PATH '$')) jt on true
	)
),
cteAclRulesRanked as (
    select /*+ NO_MERGE() */
		saId,
        access,
        asset,
        benchmarkId,
        json_arrayagg(aclSource) over (partition by saId, access, specificity) as aclSources,
        specificity,
		row_number() over (partition by saId order by specificity desc, access asc) as rn
	from 
		cteAclRules)
select /*+ NO_MERGE() */ access, asset, benchmarkId, aclSources from cteAclRulesRanked where rn = 1 and access != 'none'`
  const [response] = await dbUtils.pool.query(sqlSelectEffectiveGrants, [collectionId, userId, collectionId, userId])
  return response
}

exports.setValidatedAcl = async function({validatedAcl, grantId, attributionUserId, svcStatus = {}}) {
  const sqlDelete = `DELETE from collection_grant_acl WHERE grantId = ?`
  const values = validatedAcl.map(i => [i.grantId, i.assetId, i.benchmarkId, i.clId, i.access, attributionUserId])
  if (values.length) {
    return dbUtils.retryOnDeadlock2({
      transactionFn, 
      statusObj: svcStatus
    })
  }
  else {
    return dbUtils.pool.query(sqlDelete, [grantId])
  }

  async function transactionFn (connection) {  
    const sqlInsert = `INSERT into collection_grant_acl (grantId, assetId, benchmarkId, clId, access, modifiedUserId) VALUES ?`
    await connection.query(sqlDelete, [grantId])
    await connection.query(sqlInsert, [values])
  }
}

exports._reviewAclValidate = async function ({grantId, acl}) {
  const sql = `
  select
    any_value(cg.grantId) as grantId,
    group_concat(jt.itemNum) as itemNum,
    case when count(jt.item) > 1 then json_arrayagg(jt.item) else any_value(jt.item) end as item,
    jt.assetId,
    jt.benchmarkId,
    cl.clId,
      group_concat(jt.access) as access,
      group_concat(case when any_value(cg.roleId) != 1 and jt.access = 'none'
        then 'roleId prohibits access:none'
        else case when jt.assetId is not null and a.assetId is null
          then 'asset not found in collection'
          else case when jt.benchmarkId is not null and s.benchmarkId is null
            then 'stig not installed'
            else case when jt.labelId is not null and cl.clId is null
              then 'label not found in collection'
              else 'pass'
            end
          end
        end
      end) as validity,
    count(jt.item) as dupCount
  from
    json_table(
      ?,
      "$[*]" COLUMNS (
        itemNum FOR ORDINALITY,
        item JSON PATH '$',
        assetId INT PATH '$.assetId',
        benchmarkId VARCHAR(255) PATH '$.benchmarkId',
        labelId VARCHAR(255) PATH '$.labelId',
        access VARCHAR(255) PATH '$.access'
    )) jt
    left join collection_grant cg on (cg.grantId = ?)
    left join collection_label cl on cl.uuid = UUID_TO_BIN(jt.labelId,1) and cg.collectionId = cl.collectionId
    left join asset a on jt.assetId = a.assetId and a.state = 'enabled' and cg.collectionId = a.collectionId
    left join stig s on jt.benchmarkId collate utf8mb4_0900_as_cs = s.benchmarkId
  group by
    jt.assetId, jt.benchmarkId, jt.labelId, cl.clId
  order by
    itemNum`
    
  const [rows] = await dbUtils.pool.query(sql, [JSON.stringify(acl), grantId])

  const response = rows.reduce((a,v) => {
    const disposition = v.validity === 'pass' ? 'pass' : 'fail'
    if (disposition === 'fail') {
      delete v.grantId
      delete v.assetId
      delete v.benchmarkId
      delete v.clId
      delete v.access
      if (v.dupCount > 1) v.validity += ',duplicate resource definition'
    }
    delete v.dupCount
    a[disposition].push(v)
    return a
  }, {pass:[], fail:[]})
  return response
}

exports._getCollectionGrant = async function ({collectionId, grantId, grantIds, userId, userGroupId}) {
  let sql = `select
	case when user_data.userId
  then json_object(
    'grantId', cast(grantId as char),
    'user', json_object(
      'userId', CAST(user_data.userId as char),
      'username', user_data.username,
      'displayName', COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(user_data.lastClaims, "$.name")),
      user_data.username)),
    'roleId', roleId)
  else json_object(
    'grantId', cast(grantId as char),
    'userGroup', json_object(
      'userGroupId', CAST(user_group.userGroupId as char),
      'name', user_group.name,
      'description', user_group.description
      ),
    'roleId', roleId) end as grantJson
  from
    collection_grant
    left join user_data using (userId)
    left join user_group using (userGroupId)
    where collectionId = ?`
  if (grantId) {
    sql += ' and grantId = ?'
  }
  else if (grantIds) {
    sql += ' and grantId IN (?)'
  }
  else if (userId) {
    sql += ' and userId = ?'
  }
  else if (userGroupId) {
    sql += ' and userGroupId = ?'
  }
  const [response] = await dbUtils.pool.query(sql, [collectionId, grantId || grantIds || userId || userGroupId])
  const grants = response.map(row => row.grantJson)
  return grants
}

exports.putGrantById = function ({grantId, grant, isRoleChange = false, svcStatus = {}}) {

  const sqlUpdate = `UPDATE collection_grant SET userId = ?,userGroupId = ?,roleId = ? where grantId = ?`
  const bindsUpdate = [grant.userId, grant.userGroupId, grant.roleId, grantId]

  if (isRoleChange) {
    // need a transaction
    async function transactionFn (connection) {  
      const sqlDelete = `DELETE from collection_grant_acl WHERE grantId = ? and access = 'none'`
      await connection.query(sqlDelete, [grantId])
      await connection.query(sqlUpdate, bindsUpdate)
    }
    
    return dbUtils.retryOnDeadlock2({
      transactionFn, 
      statusObj: svcStatus
    })
  
  }
  else {
    return dbUtils.pool.query(sqlUpdate, bindsUpdate)
  }
}

exports.deleteGrantById = async function (grantId) {
  const sql = `DELETE from collection_grant WHERE grantId = ?`
  return dbUtils.pool.query(sql, [grantId])
}

exports.postGrantsByCollection = async function (collectionId, grants) {
  const binds = grants.map( g => [collectionId, g.userId, g.userGroupId, g.roleId])
  const sql = `INSERT into collection_grant (collectionId, userId, userGroupId, roleId) VALUES ?`
  const [result] = await dbUtils.pool.query(sql, [binds])
  const grantIds = []
  for (let x = 0; x < result.affectedRows; x++) {
    grantIds.push(result.insertId + x)
  }
  return grantIds
}

exports._hasCollectionGrant = async function ({collectionId, userId}) {

    const sql = `SELECT cg.grantId
      FROM collection_grant cg 
      LEFT JOIN user_group ug ON cg.userGroupId = ug.userGroupId
      LEFT JOIN user_data ud on cg.userID = ud.userId
      LEFT JOIN user_group_user_map ugu ON ug.userGroupId = ugu.userGroupId
      WHERE cg.collectionId = ? AND (ud.userId = ? OR ugu.userId = ?)`

  const [response] = await dbUtils.pool.query(sql, [collectionId, userId, userId])
  return !!response[0]
}

exports.queryReviewAcl = async function ({grantId, collectionId, userId, userGroupId}) {
  const columns = [
    `case when cg.roleId = 1 then 'none' else 'rw' end as defaultAccess`,
    `case when count(cga.cgAclId) = 0
      THEN json_array()
      ELSE json_arrayagg(
        json_remove(json_object(
          CASE WHEN cga.benchmarkId is null THEN 'x' ELSE 'benchmarkId' END, cga.benchmarkId,
          CASE WHEN cga.assetId is null THEN 'x' ELSE 'asset' END, 
          CASE WHEN cga.assetId is null THEN NULL ELSE json_object('assetId',cast(cga.assetId as char),'name',a.name) END,
          CASE WHEN cga.clId is null THEN 'x' ELSE 'label' END,
          CASE WHEN cga.clId is null THEN NULL ELSE json_object('labelId',BIN_TO_UUID(cl.uuid,1), 'name', cl.name, 'color', cl.color) END,
          'access', cga.access
        ), '$.x'))
      END as acl`
  ]
  const joins = [
    'collection_grant cg',
    'inner join collection c on cg.collectionId = c.collectionId and c.state = "enabled"',
    'left join collection_grant_acl cga on cg.grantId = cga.grantId',
    'left join asset a on cga.assetId = a.assetId',
    'left join collection_label cl on cga.clId = cl.clId'
    ]

    const predicates = {
    statements: [`(a.state = 'enabled' or a.assetId is null)`],
    binds: []
  }

  if (grantId) {
    predicates.statements.push('cg.grantId = ?')
    predicates.binds.push(grantId)
  }
  else if (userId && collectionId) {
    predicates.statements.push('cg.userId = ?', 'cg.collectionId = ?')
    predicates.binds.push(userId, collectionId)
  }
  else if (userGroupId && collectionId) {
    predicates.statements.push('cg.userGroupId = ?', 'cg.collectionId = ?')
    predicates.binds.push(userGroupId, collectionId)
  }

  const sql = dbUtils.makeQueryString({columns, joins, predicates, format: true})

  const [rows] = await dbUtils.pool.query(sql)
  return rows?.[0]
}
