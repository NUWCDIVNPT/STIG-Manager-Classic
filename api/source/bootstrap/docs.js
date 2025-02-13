
const express = require('express')
const path = require('path')
const fs = require('fs')
const logger = require('../utils/logger')
const config = require('../utils/config')
const swaggerUi = require('swagger-ui-express')
const jsyaml = require('js-yaml')

function serveDocs(app) {
    if (config.docs.disabled) {
        logger.writeDebug('serveDocs', 'client', {message: 'documentation disabled'})
        return
    }
    try {
        app.use('/docs', express.static(path.join(__dirname, "../", config.docs.docsDirectory)))
        logger.writeDebug('serveDocs', 'client', {message: 'succeeded setting up documentation'})
    }
    catch (err) {
        logger.writeError('serveDocs', 'client', {message: err.message, stack: err.stack})
    }
}

function serveApiDocs(app) {
 
     if (config.swaggerUi.enabled) {
        const oasDoc = getOAS()
        configureSwaggerUI(app, oasDoc)
     }
     else 
     {
        logger.writeDebug('serveApiDocs', 'SwaggerUI', { message: 'Swagger UI is disabled in configuration' })
     }
}

function getOAS(){
    // Read and modify OpenAPI specification
    const apiSpecPath = path.join(__dirname, '../specification/stig-manager.yaml') 
    let spec = fs.readFileSync(apiSpecPath, 'utf8')
    let oasDoc = jsyaml.load(spec)
    // Replace with config values
    oasDoc.info.version = config.version
    oasDoc.servers[0].url = config.swaggerUi.server
    oasDoc.components.securitySchemes.oauth.openIdConnectUrl = `${config.client.authority}/.well-known/openid-configuration`
    config.definition = oasDoc
    return oasDoc
}

function configureSwaggerUI(app, oasDoc){
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(oasDoc, null, {
        oauth2RedirectUrl: config.swaggerUi.oauth2RedirectUrl,
        oauth: {
        usePkceWithAuthorizationCodeGrant: true
        }
    }))
    app.get(['/swagger.json','/openapi.json'], function(req, res) {
        res.json(oasDoc)
    })
    logger.writeDebug('configureSwaggerUI', 'client', {message: 'succeeded setting up swagger-ui'})
}

module.exports = { serveDocs, serveApiDocs }