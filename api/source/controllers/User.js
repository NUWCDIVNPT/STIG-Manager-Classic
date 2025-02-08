'use strict';

const config = require('../utils/config')
const UserService = require(`../service/UserService`)
const AssetService = require(`../service/AssetService`)
const CollectionService = require(`../service/CollectionService`)
const SmError = require('../utils/error')
/*  */
module.exports.createUser = async function createUser (req, res, next) {
  try {
    const elevate = req.query.elevate
    if (!elevate) throw new SmError.PrivilegeError()
    let body = req.body
    let projection = req.query.projection

    if (body.hasOwnProperty('collectionGrants') ) {
      // Verify each grant for a valid collectionId
      let requestedIds = body.collectionGrants.map( g => g.collectionId )
      let availableCollections = await CollectionService.queryCollections({elevate})
      let availableIds = availableCollections.map( c => c.collectionId)
      if (! requestedIds.every( id => availableIds.includes(id) ) ) {
        throw new SmError.UnprocessableError('One or more collectionIds are invalid.')
      }
    }
    try {
      let response = await UserService.createUser(body, projection, elevate, req.userObject, res.svcStatus)
      res.status(201).json(response)
    }
    catch (err) {
      // This is MySQL specific, should abstract
      if (err.code === 'ER_DUP_ENTRY') {
        throw new SmError.UnprocessableError('Duplicate name exists.')
      }
      else {
        throw err
      }
    }
  }
  catch(err) {
    next(err)
  }
}

module.exports.deleteUser = async function deleteUser (req, res, next) {
  try {
    let elevate = req.query.elevate
    if (elevate) {
      let userId = req.params.userId
      let projection = req.query.projection
      let userData = await UserService.getUserByUserId(userId, [], elevate, req.userObject)
      if (userData?.lastAccess) {
        // User has accessed the system, so we need to reject the request
        throw new SmError.UnprocessableError('User has accessed the system. Use PATCH to remove collection grants or configure Authentication provider to reject user entirely.')
      }
      let response = await UserService.deleteUser(userId, projection, elevate, req.userObject)
      res.json(response)
    }
    else {
      throw new SmError.PrivilegeError()    
    }
  }
  catch(err) {
    next(err)
  }
}

module.exports.exportUsers = async function exportUsers (projection, elevate, userObject) {
  if (elevate) {
    return await UserService.getUsers(null, null, projection, elevate, userObject )
  }
  else {
    throw new SmError.PrivilegeError()    
  }
} 

module.exports.exportUserGroups = async function exportUserGroups (projections, elevate) {

  if (elevate) {
    return await UserService.queryUserGroups({projections})
  }
  else {
    throw new SmError.PrivilegeError()    
  }
}

module.exports.getUser = async function getUser (req, res, next) {
  try {
    let response = await UserService.getUserByUserId(req.userObject.userId, ['collectionGrants', 'statistics', 'userGroups'])
    response.privileges = req.userObject.privileges
    res.json(response)
}
  catch(err) {
    next(err)
  }
}

module.exports.getUserByUserId = async function getUserByUserId (req, res, next) {
  try {
    let elevate = req.query.elevate
    if ( elevate ) {
      let userId = req.params.userId
      let projection = req.query.projection
      let response = await UserService.getUserByUserId(userId, projection, elevate, req.userObject)
      if(!response) {
        throw new SmError.NotFoundError()
      }
      res.json(response)
    }
    else {
      throw new SmError.PrivilegeError()    
    }
  }
  catch(err) {
    next(err)
  }
}

module.exports.getUsers = async function getUsers (req, res, next) {
  try {
    let elevate = req.query.elevate
    let username = req.query.username
    let usernameMatch = req.query['username-match']
    let privilege = req.query['privilege']
    let projection = req.query.projection
    if ( !elevate && projection?.length > 0) {
      throw new SmError.PrivilegeError()
    }
    let response = await UserService.getUsers( username, usernameMatch, privilege, projection, elevate, req.userObject)
    res.json(response)
  }
  catch(err) {
    next(err)
  }
}

module.exports.replaceUser = async function replaceUser (req, res, next) {
  try {
    let elevate = req.query.elevate
    let userId = req.params.userId
    if (!elevate) throw new SmError.PrivilegeError() 
    let body = req.body
    let projection = req.query.projection

    let userData = await UserService.getUserByUserId(userId)
    if (!userData) {
      throw new SmError.NotFoundError("UserId not found.")
    }

    if (body.hasOwnProperty('collectionGrants') ) {
      // Verify each grant for a valid collectionId
      let requestedIds = body.collectionGrants.map( g => g.collectionId )
      let availableCollections = await CollectionService.queryCollections({elevate})
      let availableIds = availableCollections.map( c => c.collectionId)
      if (! requestedIds.every( id => availableIds.includes(id) ) ) {
        throw new SmError.UnprocessableError('One or more collectionIds are invalid.')
      }
    }

    let response = await UserService.replaceUser(userId, body, projection, elevate, req.userObject, res.svcStatus)
    res.json(response)
  }
  catch(err) {
    next(err)
  }
}

module.exports.updateUser = async function updateUser (req, res, next) {
  try {
    let elevate = req.query.elevate
    let userId = req.params.userId
    if (elevate) {
      let body = req.body
      let projection = req.query.projection

      let userData = await UserService.getUserByUserId(userId)
      if (!userData) {
        throw new SmError.NotFoundError("UserId not found.")
      }

      if (body.hasOwnProperty('collectionGrants') ) {
        // Verify each grant for a valid collectionId
        let requestedIds = body.collectionGrants.map( g => g.collectionId )
        let availableCollections = await CollectionService.queryCollections({elevate})
        let availableIds = availableCollections.map( c => c.collectionId)
        if (! requestedIds.every( id => availableIds.includes(id) ) ) {
          throw new SmError.UnprocessableError('One or more collectionIds are invalid.')
        }
      }

      let response = await UserService.replaceUser(userId, body, projection, elevate, req.userObject, res.svcStatus)
      res.json(response)
    }
    else {
     throw new SmError.PrivilegeError()    
    }
  }
  catch(err) {
    next(err)
  }
}

/* c8 ignore start */
module.exports.setUserData = async function setUserData (username, fields) {
  try {
    await UserService.setUserData(username, fields)
    return await UserService.getUserByUsername(username)
  }
  catch (e) {
    next(err)

  }
}
/* c8 ignore end */
module.exports.createUserGroup = async (req, res, next) => {
  try {
    if (!req.query.elevate) throw new SmError.PrivilegeError()
    const {userIds, ...userGroupFields} = req.body
    let userGroupId
    try{
      userGroupId = await UserService.addOrUpdateUserGroup({
        userGroupFields,
        userIds,
        createdUserId: req.userObject.userId,
        modifiedUserId: req.userObject.userId
      })
    }
    catch (err) {
      throw err.code === 'ER_DUP_ENTRY' ? new SmError.UnprocessableError('Group name is already in use.') : err
    }
    const response = await UserService.queryUserGroups({
      projections: req.query.projection,
      filters: {userGroupId}
    })
    res.status(201).json(response[0])
  }
  catch (err) {
    next(err)
  }
}

module.exports.getUserGroups = async (req, res, next) => {
  try {
    if (req.query.projection?.includes('collections') && !req.query.elevate) {
      throw new SmError.PrivilegeError('collections projection requires elevation')
    }
    const response = await UserService.queryUserGroups({
      projections: req.query.projection
    })
    res.json(response)
  }
  catch (err) {
    next(err)
  }
}

module.exports.getUserGroup = async (req, res, next) => {
  try {
    if (req.query.projection?.includes('collections') && !req.query.elevate) {
      throw new SmError.PrivilegeError('collections projection requires elevation')
    }
    const response = await UserService.queryUserGroups({
      projections: req.query.projection,
      filters: {userGroupId: req.params.userGroupId}
    })
    if (!response[0]) throw new SmError.NotFoundError()
    res.json(response[0])
  }
  catch (err) {
    next(err)
  }
}

async function putOrPatchUserGroup (req, res, next) {
  try {
    if (!req.query.elevate) throw new SmError.PrivilegeError()
    const {userIds, ...userGroupFields} = req.body
    const userGroup = await UserService.queryUserGroups({
      projections: [],
      filters: {userGroupId: req.params.userGroupId}
    })
    if (!userGroup.length) throw new SmError.NotFoundError("UserGroup not found.")
    const userGroupId = await UserService.addOrUpdateUserGroup({
      userGroupId: req.params.userGroupId,
      userGroupFields,
      userIds,
      modifiedUserId: req.userObject.userId
    })
    const response = await UserService.queryUserGroups({
      projections: req.query.projection,
      filters: {userGroupId}
    })
    res.json(response[0])
  }
  catch (err) {
    next(err)
  }
}

module.exports.patchUserGroup = putOrPatchUserGroup
module.exports.putUserGroup = putOrPatchUserGroup

module.exports.deleteUserGroup = async (req, res, next) => {
  try{
    if (!req.query.elevate) throw new SmError.PrivilegeError()
    const response = await UserService.queryUserGroups({
      projections: req.query.projection,
      filters: {userGroupId: req.params.userGroupId}
    })
    await UserService.deleteUserGroup({
      userGroupId: req.params.userGroupId,
    })
    res.json(response[0])
  }
  catch (err) {
    next(err)
  }
}

