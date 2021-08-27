'use strict';

var writer = require('../utils/writer')
var config = require('../utils/config')
var Collection = require(`../service/${config.database.type}/CollectionService`)
var Serialize = require(`../utils/serializers`)
var Security = require('../utils/accessLevels')

module.exports.createCollection = async function createCollection (req, res, next) {
  try {
    const projection = req.query.projection
    const elevate = req.query.elevate
    const body = req.body
    if ( elevate || req.userObject.privileges.canCreateCollection ) {
      try {
        const response = await Collection.createCollection( body, projection, req.userObject)
        res.status(201).json(response)
      }
      catch (err) {
        // This is MySQL specific, should abstract
        if (err.code === 'ER_DUP_ENTRY') {
          // try {
            let response = await Collection.getCollections({
              name: body.name
            }, projection, elevate, req.userObject )
            throw ({
              status: 400,
              message: `Duplicate name`,
              data: response[0] ?? null
            })
          // } finally {}
        }
        else {
          throw err
        }
      }
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }  
}

module.exports.deleteCollection = async function deleteCollection (req, res, next) {
  try {
    const elevate = req.query.elevate
    const collectionId = req.params.collectionId
    const projection = req.query.projection
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if (elevate || (collectionGrant && collectionGrant.accessLevel === 4)) {
      const response = await Collection.deleteCollection(collectionId, projection, elevate, req.userObject)
      res.json(response)
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.exportCollections = async function exportCollections (projection, elevate, userObject) {
  try {
    return await Collection.getCollections( {}, projection, elevate, userObject )
  }
  catch (err) {
    next(err)
  }
} 

module.exports.getChecklistByCollectionStig = async function getChecklistByCollectionStig (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const benchmarkId = req.params.benchmarkId
    const revisionStr = req.params.revisionStr
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if ( collectionGrant || req.userObject.privileges.globalAccess ) {
      const response = await Collection.getChecklistByCollectionStig(collectionId, benchmarkId, revisionStr, req.userObject )
      res.json(response)
    }
    else {
      throw({status: 403, message: 'User has insufficient privilege to complete this request.'})
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.getCollection = async function getCollection (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const projection = req.query.projection
    const elevate = req.query.elevate
    
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if (collectionGrant || req.userObject.privileges.globalAccess || elevate ) {
      const response = await Collection.getCollection(collectionId, projection, elevate, req.userObject )
      res.status(typeof response === 'undefined' ? 204 : 200).json(response)
    }
    else {
      throw({status: 403, message: 'User has insufficient privilege to complete this request.'})
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.getCollections = async function getCollections (req, res, next) {
  try {
    const projection = req.query.projection
    const elevate = req.query.elevate
    const name = req.query.name
    const nameMatch = req.query['name-match']
    const workflow = req.query.workflow
    const metadata = req.query.metadata
    const response = await Collection.getCollections({
      name: name,
      nameMatch: nameMatch,
      workflow: workflow,
      metadata: metadata
    }, projection, elevate, req.userObject)
    res.json(response)
  }
  catch (err) {
    next(err)
  }
}

module.exports.getFindingsByCollection = async function getFindingsByCollection (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const aggregator = req.query.aggregator
    const benchmarkId = req.query.benchmarkId
    const assetId = req.query.assetId
    const acceptedOnly = req.query.acceptedOnly
    const projection = req.query.projection
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if (collectionGrant || req.userObject.privileges.globalAccess ) {
      const response = await Collection.getFindingsByCollection( collectionId, aggregator, benchmarkId, assetId, acceptedOnly, projection, req.userObject )
      res.json(response)
      }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.getPoamByCollection = async function getFindingsByCollection (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const aggregator = req.query.aggregator
    const benchmarkId = req.query.benchmarkId
    const assetId = req.query.assetId
    const acceptedOnly = req.query.acceptedOnly
    const defaults = {
      date: req.query.date,
      office: req.query.office,
      status: req.query.status
    }
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if (collectionGrant || req.userObject.privileges.globalAccess ) {
      const response = await Collection.getFindingsByCollection( collectionId, aggregator, benchmarkId, assetId, acceptedOnly, 
        [
          'rulesWithDiscussion',
          'groups',
          'assets',
          'stigsInfo',
          'ccis'
        ], req.userObject )
      
      const po = Serialize.poamObjectFromFindings(response, defaults)
      const xlsx = await Serialize.xlsxFromPoamObject(po)
      let collectionName
      if (!collectionGrant && req.userObject.privileges.globalAccess) {
        const response = await Collection.getCollection(collectionId, [], false, req.userObject )
        collectionName = response.name
      }
      else {
        collectionName = collectionGrant.collection.name
      }
      writer.writeInlineFile( res, xlsx, `POAM-${collectionName}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.getStatusByCollection = async function getStatusByCollection (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const benchmarkId = req.query.benchmarkId
    const assetId = req.query.assetId
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if (collectionGrant || req.userObject.privileges.globalAccess ) {
      const response = await Collection.getStatusByCollection( collectionId, assetId, benchmarkId, req.userObject )
      res.json(response)
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.getStigAssetsByCollectionUser = async function getStigAssetsByCollectionUser (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const userId = req.params.userId
    
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if ( collectionGrant && collectionGrant.accessLevel >= 3 ) {
      const response = await Collection.getStigAssetsByCollectionUser(collectionId, userId, req.userObject )
      res.json(response)
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.getStigsByCollection = async function getStigsByCollection (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if (collectionGrant || req.userObject.privileges.globalAccess ) {
      const response = await Collection.getStigsByCollection( collectionId, false, req.userObject )
      res.json(response)
      }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.replaceCollection = async function updateCollection (req, res, next) {
  try {
    const elevate = req.query.elevate
    const collectionId = req.params.collectionId
    const projection = req.query.projection
    const body = req.body
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if ( elevate || (collectionGrant && collectionGrant.accessLevel >= 3) ) {
      const response = await Collection.replaceCollection(collectionId, body, projection, req.userObject)
      res.json(response)
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }    
  }
  catch (err) {
    next(err)
  }
}

module.exports.setStigAssetsByCollectionUser = async function setStigAssetsByCollectionUser (req, res, next) {
  try {
    const collectionId = req.params.collectionId
    const userId = req.params.userId
    const stigAssets = req.body
    
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if ( collectionGrant && collectionGrant.accessLevel >= 3 ) {
      const collectionResponse = await Collection.getCollection(collectionId, ['grants'], false, req.userObject )
      if (collectionResponse.grants.filter( grant => grant.accessLevel === 1 && grant.user.userId === userId).length > 0) {
        const setResponse = await Collection.setStigAssetsByCollectionUser(collectionId, userId, stigAssets, req.userObject ) 
        const getResponse = await Collection.getStigAssetsByCollectionUser(collectionId, userId, req.userObject )
        res.json(getResponse)    
      }
      else {
        throw( {status: 404, message: "User not found in this Collection with accessLevel === 1."})
      }
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }
  }
  catch (err) {
    next(err)
  }
}

module.exports.updateCollection = async function updateCollection (req, res, next) {
  try {
    const elevate = req.query.elevate
    const collectionId = req.params.collectionId
    const projection = req.query.projection
    const body = req.body
    const collectionGrant = req.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
    if ( elevate || (collectionGrant && collectionGrant.accessLevel >= 3) ) {
      let response = await Collection.replaceCollection(collectionId, body, projection, req.userObject)
      res.json(response)
    }
    else {
      throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
    }    
  }
  catch (err) {
    next(err)
  }
}


async function getCollectionIdAndCheckPermission(request, minimumAccessLevel = Security.ACCESS_LEVEL.Manage, allowElevate = false) {
  let collectionId = request.params.collectionId
  const elevate = request.query.elevate
  const collectionGrant = request.userObject.collectionGrants.find( g => g.collection.collectionId === collectionId )
  if (!( (allowElevate && elevate) || (collectionGrant && collectionGrant.accessLevel >= minimumAccessLevel) )) {
    throw( {status: 403, message: "User has insufficient privilege to complete this request."} )
  }
  return collectionId
}

module.exports.getCollectionMetadata = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req)
    let result = await Collection.getCollectionMetadata(collectionId, req.userObject)
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}

module.exports.patchCollectionMetadata = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req)
    let metadata = req.body
    await Collection.patchCollectionMetadata(collectionId, metadata)
    let result = await Collection.getCollectionMetadata(collectionId)
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}

module.exports.putCollectionMetadata = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req)
    let body = req.body
    await Collection.putCollectionMetadata( collectionId, body)
    let result = await Collection.getCollectionMetadata(collectionId)
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}

module.exports.getCollectionMetadataKeys = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req)
    let result = await Collection.getCollectionMetadataKeys(collectionId, req.userObject)
    if (!result)  
      throw ( {status: 404, message: "metadata keys not found"} )
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}

module.exports.getCollectionMetadataValue = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req)
    let key = req.params.key
    let result = await Collection.getCollectionMetadataValue(collectionId, key, req.userObject)
    if (!result) {
      throw ( {status: 404, message: "metadata key not found"} )
    }
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}

module.exports.putCollectionMetadataValue = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req)
    let key = req.params.key
    let value = req.body
    let result = await Collection.putCollectionMetadataValue(collectionId, key, value)
    res.status(204).send()
  }
  catch (err) {
    next(err)
  }  
}


module.exports.deleteCollectionMetadataKey = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req)
    let key = req.params.key
    let result = await Collection.deleteCollectionMetadataKey(collectionId, key, req.userObject)
    res.status(204).send()
  }
  catch (err) {
    next(err)
  }  
}



module.exports.deleteReviewHistoryByCollection = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req, Security.ACCESS_LEVEL.Manage)
    const retentionDate = req.query.retentionDate
    const assetId = req.query.assetId
    
    let result = await Collection.deleteReviewHistoryByCollection(collectionId, retentionDate, assetId)
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}

module.exports.getReviewHistoryByCollection = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req, Security.ACCESS_LEVEL.Full)
    const startDate = req.query.startDate
    const endDate = req.query.endDate
    const assetId = req.query.assetId
    const ruleId = req.query.ruleId
    const status = req.query.status

    let result = await Collection.getReviewHistoryByCollection(collectionId, startDate, endDate, assetId, ruleId, status)
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}

module.exports.getReviewHistoryStatsByCollection = async function (req, res, next) {
  try {
    let collectionId = await getCollectionIdAndCheckPermission(req, Security.ACCESS_LEVEL.Full)
    const startDate = req.query.startDate
    const endDate = req.query.endDate
    const assetId = req.query.assetId
    const ruleId = req.query.ruleId
    const status = req.query.status
    const projection = req.query.projection

    let result = await Collection.getReviewHistoryStatsByCollection(collectionId, startDate, endDate, assetId, ruleId, status, projection)
    res.json(result)
  }
  catch (err) {
    next(err)
  }  
}