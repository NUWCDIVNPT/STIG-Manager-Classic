'use strict';

var utils = require('../utils/writer.js')
var config = require('../utils/config')
var Package = require(`../service/${config.database.type}/PackageService`)

module.exports.createPackage = async function createPackage (req, res, next) {
  if ( req.userObject.canAdmin  || req.userObject.role == 'Staff' ) {
    try {
      let projection = req.swagger.params['projection'].value
      let body = req.body
      let response = await Package.createPackage( body, projection, req.userObject)
      utils.writeJson(res, response)
    }
    catch (err) {
      utils.writeJson(res, err)
    }
  } 
  else {
    utils.writeJson(res, utils.respondWithCode ( 401, {message: "User has insufficient privilege to complete this request."} ) )
  }
}

module.exports.deletePackage = async function deletePackage (req, res, next) {
  if ( req.userObject.canAdmin ) {
    try {
      let packageId = req.swagger.params['packageId'].value
      let projection = req.swagger.params['projection'].value
      let response = await Package.deletePackage(packageId, projection, req.userObject)
      utils.writeJson(res, response)
    }
    catch (err) {
      utils.writeJson(res, err)
    }
  }
  else {
    utils.writeJson(res, utils.respondWithCode ( 401, {message: "User has insufficient privilege to complete this request."} ) )
  }
}

module.exports.getPackage = async function getPackage (req, res, next) {
  let packageId = req.swagger.params['packageId'].value
  let projection = req.swagger.params['projection'].value
  let elevate = req.swagger.params['elevate'].value
  try {
    let response = await Package.getPackage(packageId, projection, elevate, req.userObject )
    utils.writeJson(res, response)
  }
  catch (err) {
    utils.writeJson(res, err)
  }
}

module.exports.getPackages = async function getPackages (req, res, next) {
  let projection = req.swagger.params['projection'].value
  let elevate = req.swagger.params['elevate'].value
  try {
    let response = await Package.getPackages(projection, elevate, req.userObject)
    utils.writeJson(res, response)
  }
  catch (err) {
    utils.writeJson(res, err)
  }
}

module.exports.updatePackage = async function updatePackage (req, res, next) {
  if ( req.userObject.canAdmin  || req.userObject.role == 'Staff' ) {
    try {
      let packageId = req.swagger.params['packageId'].value
      let projection = req.swagger.params['projection'].value
      let body = req.body
      let response = await Package.updatePackage(packageId, body, projection, req.userObject)
      utils.writeJson(res, response)
    }
    catch (err) {
      utils.writeJson(res, err)
    }
  } 
  else {
    utils.writeJson(res, utils.respondWithCode ( 401, {message: "User has insufficient privilege to complete this request."} ) )
  }
}
