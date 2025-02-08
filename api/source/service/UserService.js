'use strict';
const config = require('../utils/config')
const dbUtils = require('./utils')

const _this = this

/**
Generalized queries for users
**/
exports.queryUsers = async function (inProjection, inPredicates, elevate, userObject) {
  const ctes = []
  let needsCollectionGrantees = false
  const columns = [
    'CAST(ud.userId as char) as userId',
    'ud.username',
    'ud.lastAccess',
    `json_extract(
      ud.lastClaims, ?
    ) as email`,
    `COALESCE(json_unquote(json_extract(
      ud.lastClaims, ?
    )), ud.username) as displayName`,
    `json_object(
      'create_collection', 'create_collection' member of(JSON_VALUE(ud.lastClaims, ? default '[]' on empty)),
      'admin', 'admin' member of(JSON_VALUE(ud.lastClaims, ? default '[]' on empty))
    ) as 'privileges'`
  ]
  const joins = new Set([
    'user_data ud'
  ])
  const groupBy = ['ud.userId']

  const orderBy = ['ud.username']

  // PROJECTIONS
  if (inProjection?.includes('collectionGrants')) {
    needsCollectionGrantees = true
    joins.add('left join cteGrantees cgs on ud.userId = cgs.userId')
    joins.add('left join collection c on cgs.collectionId = c.collectionId')
    columns.push(`case when count(cgs.collectionId) > 0
    then 
      ${dbUtils.jsonArrayAggDistinct(`json_object(
        'collection', json_object(
          'collectionId', CAST(cgs.collectionId as char),
          'name', c.name
        ),
        'roleId', cgs.roleId,
        'grantees', cgs.grantees
      )`)}
    else json_array() 
    end as collectionGrants`)
  }

  if (inProjection?.includes('statistics')) {
    needsCollectionGrantees = true
    joins.add('left join cteGrantees cgs on ud.userId = cgs.userId')
    columns.push(`json_object(
        'created', date_format(ud.created, '%Y-%m-%dT%TZ'),
        'collectionGrantCount', count(distinct cgs.collectionId),
        'lastClaims', ud.lastClaims
      ) as statistics`)
    groupBy.push(
      'ud.lastAccess',
      'ud.lastClaims'
    )
  }
  if (inProjection?.includes('userGroups')) {
    joins.add('left join user_group_user_map ugu on ud.userId = ugu.userId')
    joins.add('left join user_group ug on ugu.userGroupId = ug.userGroupId')
    columns.push(`CASE WHEN COUNT(ugu.userGroupId) > 0
    THEN cast(concat('[', group_concat( distinct JSON_OBJECT(
      'userGroupId', cast(ugu.userGroupId as char),
      'name', ug.name
    )), ']') as json)
    ELSE json_array()
    END as userGroups`)
  }

  // PREDICATES
  let predicates = {
    statements: [],
    binds: [
      `$.${config.oauth.claims.email}`,
      `$.${config.oauth.claims.name}`,
      `$.${config.oauth.claims.privilegesPath}`,
      `$.${config.oauth.claims.privilegesPath}`
    ]
  }
  if (inPredicates.userId) {
    predicates.statements.push('ud.userId = ?')
    predicates.binds.push(inPredicates.userId)
  }
  if ( inPredicates.username ) {
    let matchStr = '= ?'
    if ( inPredicates.usernameMatch && inPredicates.usernameMatch !== 'exact') {
      matchStr = 'LIKE ?'
      switch (inPredicates.usernameMatch) {
        case 'startsWith':
          inPredicates.username = `${inPredicates.username}%`
          break
        case 'endsWith':
          inPredicates.username = `%${inPredicates.username}`
          break
        case 'contains':
          inPredicates.username = `%${inPredicates.username}%`
          break
      }
    }
    predicates.statements.push(`ud.username ${matchStr}`)
    predicates.binds.push(inPredicates.username)
  }
  
  if (inPredicates.privilege) {
    predicates.statements.push(
      `JSON_CONTAINS(JSON_EXTRACT(ud.lastClaims, ?), ?) `
    )
    predicates.binds.push(`$.${config.oauth.claims.privilegesPath}`, JSON.stringify([inPredicates.privilege]))
  }
  
  
  if (needsCollectionGrantees) {
    ctes.push(dbUtils.sqlGrantees({userId: inPredicates.userId, username: inPredicates.username, returnCte: true}))
  }

  // CONSTRUCT MAIN QUERY
  const sql = dbUtils.makeQueryString({ctes, columns, joins, predicates, groupBy, orderBy, format: true})
  let [rows] = await dbUtils.pool.query(sql)
  return (rows)
}

exports.addOrUpdateUser = async function (writeAction, userId, body, projection, elevate, userObject, svcStatus = {}) {
  let connection 
  try {
    // CREATE: userId will be null
    // REPLACE/UPDATE: userId is not null

    // Extract or initialize non-scalar properties to separate variables
    let { collectionGrants, userGroups, ...userFields } = body

    connection = await dbUtils.pool.getConnection()
    connection.config.namedPlaceholders = true
    async function transaction () {
      await connection.query('START TRANSACTION');

      // Process scalar properties
      let binds
      if (writeAction === dbUtils.WRITE_ACTION.CREATE) {
        // INSERT into user_data
        binds = {...userFields}
        let sqlInsert =
          `INSERT INTO
              user_data
              ( username )
            VALUES
              (:username )`
        let [result] = await connection.query(sqlInsert, binds)
        userId = result.insertId
      }
      else if (writeAction === dbUtils.WRITE_ACTION.UPDATE || writeAction === dbUtils.WRITE_ACTION.REPLACE) {
        binds = {
          userId: userId,
          values: userFields
        }
        if (Object.keys(binds.values).length > 0) {
          let sqlUpdate =
            `UPDATE
                user_data
              SET
                :values
              WHERE
                userid = :userId`
          await connection.query(sqlUpdate, binds)
        }
      }
      else {
        throw new Error('Invalid writeAction')
      }
  
      // Process grants if present
      if (collectionGrants) {
        if ( writeAction !== dbUtils.WRITE_ACTION.CREATE ) {
          // DELETE from collection_grant
          const binds = [userId]
          let sqlDeleteCollGrant = 'DELETE FROM collection_grant where userId = ?'
          if (collectionGrants.length > 0) {
            const collectionIds = collectionGrants.map(grant => grant.collectionId)
            sqlDeleteCollGrant += ' and collectionId NOT IN (?)'
            binds.push(collectionIds)
          }
          await connection.query(sqlDeleteCollGrant, binds)
        }
        if (collectionGrants.length > 0) {
          let sqlInsertCollGrant = `
            INSERT INTO 
              collection_grant (userId, collectionId, roleId)
            VALUES
              ? as new
            ON DUPLICATE KEY UPDATE
              roleId = new.roleId`      
          binds = collectionGrants.map( grant => [userId, grant.collectionId, grant.roleId])
          // INSERT into collection_grant
          await connection.query(sqlInsertCollGrant, [binds] )
        }
      }
      if (userGroups) {
        if ( writeAction !== dbUtils.WRITE_ACTION.CREATE ) {
          await connection.query('DELETE FROM user_group_user_map where userId = ?', [userId])
        }
        if (userGroups.length > 0) {
          await connection.query(
            `INSERT INTO user_group_user_map (userGroupId, userId) VALUES ?`, 
            [userGroups.map( userGroup => [userGroup, userId])]
          )
        }
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

  // Fetch the new or updated User for the response
  try {
    let row = await _this.getUserByUserId(userId, projection, elevate, userObject)
    return row
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }  
}


/**
 * Create a User
 *
 * body UserAssign 
 * projection List Additional properties to include in the response.  (optional)
 * returns List
 **/
exports.createUser = async function(body, projection, elevate, userObject, svcStatus = {}) {
  let row = await _this.addOrUpdateUser(dbUtils.WRITE_ACTION.CREATE, null, body, projection, elevate, userObject, svcStatus)
  return (row)
}


/**
 * Delete a User
 *
 * projection List Additional properties to include in the response.  (optional)
 * returns UserProjected
 **/
exports.deleteUser = async function(userId, projection, elevate, userObject) {
  try {
    let row = await _this.queryUsers(projection, { userId: userId }, elevate, userObject)
    let sqlDelete = `DELETE FROM user_data where userId = ?`
    await dbUtils.pool.query(sqlDelete, [userId])
    return (row[0])
  }
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}


/**
 * Return a User
 *
 * userId Integer Selects a User
 * projection List Additional properties to include in the response.  (optional)
 * returns UserProjected
 **/
exports.getUserByUserId = async function(userId, projection, elevate, userObject) {
  try {
    let rows = await _this.queryUsers( projection, {
      userId: userId
    }, elevate, userObject)
    return (rows[0])
  }
  catch(err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.getUserByUsername = async function(username, projection, elevate, userObject) {
  try {
    let rows = await _this.queryUsers( projection, {
      username: username
    }, elevate, userObject)
    return (rows[0])
  }
  catch(err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.getUsers = async function(username, usernameMatch, privilege, projection, elevate, userObject) {
  try {
    let rows = await _this.queryUsers( projection, {
      username: username,
      usernameMatch: usernameMatch,
      privilege: privilege
    }, elevate, userObject)
    return (rows)
  }
  catch(err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.replaceUser = async function( userId, body, projection, elevate, userObject, svcStatus = {} ) {
  try {
    let row = await _this.addOrUpdateUser(dbUtils.WRITE_ACTION.REPLACE, userId, body, projection, elevate, userObject, svcStatus)
    return (row)
  } 
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.updateUser = async function( userId, body, projection, elevate, userObject, svcStatus = {} ) {
  try {
    let row = await _this.addOrUpdateUser(dbUtils.WRITE_ACTION.UPDATE, userId, body, projection, elevate, userObject, svcStatus)
    return (row)
  } 
  catch (err) {
    throw ( {status: 500, message: err.message, stack: err.stack} )
  }
}

exports.setUserData = async function (userObject, fields) {
  if (userObject.userId) {
    await dbUtils.pool.query(`UPDATE user_data SET ? WHERE userId = ?`, [fields, userObject.userId])
    return userObject.userId
  }
  else {
    const [result] = await dbUtils.pool.query(`INSERT INTO user_data SET ?`, [{username: userObject.username, ...fields}])
    return result.insertId
  }
}

exports.addOrUpdateUserGroup = async function ({userGroupId, userGroupFields, userIds, createdUserId, modifiedUserId, svcStatus = {}}) {
  // CREATE: userGroupId is falsey
  // REPLACE/UPDATE: userGroupId is not falsey
  const isUpdate = !!userGroupId

  const sqlInsertUserGroup = `INSERT into user_group (name, description, createdUserId, modifiedUserId) VALUES (?,?,?,?)`
  const sqlUpdateUserGroup = `UPDATE user_group SET ? WHERE userGroupId = ?`
  const sqlInsertUserGroupUserMap = `INSERT into user_group_user_map (userGroupId, userId) VALUES ?`
  const sqlDeleteUserGroupUserMap = `DELETE from user_group_user_map WHERE userGroupId = ?`

  async function transactionFn (connection) {
    if (Object.keys(userGroupFields).length) {
      const sql = isUpdate ? sqlUpdateUserGroup : sqlInsertUserGroup
      const binds = isUpdate ? [userGroupFields, userGroupId] : [userGroupFields.name, userGroupFields.description, createdUserId, modifiedUserId]
      const [resultUserGroup] = await connection.query(sql, binds)
      userGroupId = isUpdate ? userGroupId : resultUserGroup.insertId
    }
    if (userIds) {
      if (isUpdate) {
        await connection.query(sqlDeleteUserGroupUserMap, [userGroupId])
      }
      if (userIds.length) {
        const binds = userIds.map( userId => [userGroupId, userId])
        await connection.query(
          sqlInsertUserGroupUserMap,
          [binds]
        ) 
      }
    }
    return userGroupId
  }

  return dbUtils.retryOnDeadlock2({
    transactionFn, 
    statusObj: svcStatus
  })
}

exports.queryUserGroups = async function ({projections = [], filters = {}, elevate = false, userObject = {}}) {
  // query components
  const columns = [
    'CAST(ug.userGroupId as char) as userGroupId',
    'ug.name',
    'ug.description'
  ]
  const joins = new Set([`user_group ug`])
  const groupBy = new Set()
  const orderBy = ['name']
  const predicates = {
    statements: [],
    binds: []
  }

  // predicates
  if (filters.userGroupId) {
    predicates.statements.push('ug.userGroupId = ?')
    predicates.binds.push(filters.userGroupId)
  }

  // projections
  if (projections.includes('attributions')) {
    joins.add('left join user_data udCreated on ug.createdUserId = udCreated.userId')
    joins.add('left join user_data udModified on ug.modifiedUserId = udModified.userId')
    columns.push(`json_object(
      'created', json_object(
        'userId', CAST(ug.createdUserId AS CHAR),
        'username', udCreated.username,
        'ts', DATE_FORMAT(ug.createdDate, '%Y-%m-%dT%H:%i:%sZ') 
        ),
      'modified', json_object(
        'userId', CAST(ug.modifiedUserId AS CHAR),
        'username', udModified.username,
        'ts', DATE_FORMAT(ug.modifiedDate, '%Y-%m-%dT%H:%i:%sZ')
        )
    ) as attributions`)
  }
  if (projections.includes('users')) {
    joins.add('left join user_group_user_map ugu using (userGroupId)')
    joins.add('left join user_data udUser on ugu.userId = udUser.userId')
    groupBy.add('ug.userGroupId')
    columns.push(`CASE WHEN count(ugu.userId)=0 
    THEN json_array()
    ELSE cast(concat('[', group_concat(distinct json_object(
      'userId', cast(ugu.userId as char),
      'username', udUser.username,
      'displayName', COALESCE(json_unquote(json_extract(
        udUser.lastClaims, '$.${config.oauth.claims.name}'
      )), udUser.username)
      )
    ), ']') as json)
    END as users`)
  }
  if (projections.includes('collections')) {
    joins.add('left join collection_grant cgg using (userGroupId)')
    joins.add('left join collection on cgg.collectionId = collection.collectionId and collection.state = "enabled"')
    groupBy.add('ug.userGroupId')
    columns.push(`CASE WHEN count(cgg.collectionId)=0 
    THEN json_array()
    ELSE cast(concat('[', group_concat(distinct json_object(
      'collectionId', cast(cgg.collectionId as char),
      'name', collection.name)
    ), ']') as json)
    END as collections`)
  }
  const sql = dbUtils.makeQueryString({columns, joins, predicates, groupBy, orderBy, format: true})
  const [rows] = await dbUtils.pool.query(sql)
  return rows
}

exports.deleteUserGroup = async function({userGroupId}) {
    const sqlDeleteUserGroup = `DELETE from user_group WHERE userGroupId = ?`
    await dbUtils.pool.query(sqlDeleteUserGroup, [userGroupId])
    return userGroupId
}

exports.getUserObject = async function (username) {
  const sql = `
  select
    userId,
    username,
    lastAccess,
    lastClaims,
    (select
      coalesce(json_objectagg(
        dt2.collectionId, json_object(
          'collectionId', dt2.collectionId,
          'name', dt2.name,
          'roleId', dt2.roleId, 
          'grantIds', dt2.grantIds)), json_object())
    from   
      (select 
        cg.collectionId,
        c.name,
        cg.roleId,
        json_array(cg.grantId) as grantIds
      from
        collection_grant cg
        inner join collection c on (cg.collectionId = c.collectionId and c.state = 'enabled')
        left join user_data ud2 on cg.userId = ud2.userId
      where
        ud2.userId = ud.userId
      union 
      select
        collectionId,
        name,
        roleId,
        grantIds
      from
        (select
          ROW_NUMBER() OVER(PARTITION BY ugu.userId, cg.collectionId ORDER BY cg.roleId desc) as rn,
          cg.collectionId,
          c.name, 
          cg.roleId,
          json_arrayagg(cg.grantId) OVER (PARTITION BY ugu.userId, cg.collectionId, cg.roleId) as grantIds
        from 
          collection_grant cg
          inner join collection c on (cg.collectionId = c.collectionId and c.state = 'enabled')
          left join user_group_user_map ugu on cg.userGroupId = ugu.userGroupId
          left join user_group ug on ugu.userGroupId = ug.userGroupId
          left join user_data ud3 on ugu.userId = ud3.userId
          left join collection_grant cgDirect on (cg.collectionId = cgDirect.collectionId and ugu.userId = cgDirect.userId)
        where
        cg.userGroupId is not null
        and cgDirect.userId is null
        and ud3.userId = ud.userId) dt
    where
      dt.rn = 1) dt2) as grants                               
  from
    user_data ud
  where
    ud.username = ?`
  const [rows] = await dbUtils.pool.query(sql, [username])
  return rows[0]
}
