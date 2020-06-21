const writer = require('../utils/writer.js')
const {promises: fs} = require('fs')
const config = require('../utils/config')
const Operation = require(`../service/${config.database.type}/OperationService`)
const Asset = require(`./Asset`)
const Collection = require(`./Collection`)
const User = require(`./User`)
const Review = require(`./Review`)
const JSZip = require("jszip");


module.exports.getVersion = async function getVersion (req, res, next) {
  try {
    let dbVersion = await Operation.getVersion()
    let response = {
      apiVersion: config.apiVersion,
      dataService: {
        type: config.database.type,
        version: dbVersion
      }
    }
    writer.writeJson(res, response)
  }
  catch(err) {
    writer.writeJson(res, err)
  }
}

module.exports.getAppData = async function getAppData (req, res, next) {
  try {
    let elevate = req.swagger.params['elevate'].value
    if ( elevate ) {
      let collections = await Collection.exportCollections( ['grants'], elevate, req.userObject )
      for (const collection of collections) {
          for (const grant of collection.grants) {
            grant.userId = grant.user.userId
            delete grant.user
          }
      }
      let users = await User.exportUsers( [], elevate, req.userObject)
      let assets = await Asset.exportAssets( ['stigGrants'], elevate, req.userObject)
      assets.forEach(asset => {
        asset.collectionId = asset.collection.collectionId
        delete asset.collection
        asset.stigGrants = asset.stigGrants.map( s => ({
          benchmarkId: s.benchmarkId,
          userIds: s.reviewers.map( r => r.userId )
        }))
      })
      // let reviews = []
      let reviews = await Review.exportReviews(['history'], req.userObject)
      reviews.forEach(r => {
        ['assetName','username','reviewComplete'].forEach(k => delete r[k])
        r.history.forEach(h => delete h.username)
      })      
      let response = {
        users: users,
        collections: collections,
        assets: assets,
        reviews: reviews
      }
      let zip = new JSZip()
      zip.file("stig-manager-appdata.json", JSON.stringify(response))
      let buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: "DEFLATE",
        compressionOptions: {
            level: 3
        }
      })
      writer.writeZipFile(res, buffer, 'stig-manager-appdata.json.zip')
      // writer.writeJsonFile(res, response, 'stig-manager-appdata.json')
    }
    else {
      throw( writer.respondWithCode ( 403, {message: `User has insufficient privilege to complete this request.`} ) )
    }
  }
  catch (err) {
    writer.writeJson(res, err, 500)
  }
}

module.exports.replaceAppData = async function replaceAppData (req, res, next) {
  try {
    let elevate = req.swagger.params['elevate'].value
    let appdata
    if ( elevate ) {
      if (req.file && (req.file.mimetype === 'application/json' || req.file.mimetype === 'application/zip')) {
        let data = await fs.readFile(req.file.path)
        if (req.file.mimetype === 'application/zip') {
          let zipIn = new JSZip()
          let contents = await zipIn.loadAsync(data)
          let fns = Object.keys(contents.files)
          if (fns.length > 1) {
            throw( writer.respondWithCode ( 400, {message: `ZIP archive has too many files.`} ) )
          }
          let fn = fns[0]
          data = await contents.files[fn].async("nodebuffer")
        }
        appdata = JSON.parse(data)
      }
      else {
        appdata = req.swagger.params['body'].value
      }
      let options = []
      let response = await Operation.replaceAppData(options, appdata, req.userObject, res )
      // writer.writeJson(res, response)
    }
    else {
      writer.writeJson(res, writer.respondWithCode ( 403, {message: `User has insufficient privilege to complete this request.`} ) )
    }
  }
  catch (err) {
    writer.writeJson(res, err)
  }
}
