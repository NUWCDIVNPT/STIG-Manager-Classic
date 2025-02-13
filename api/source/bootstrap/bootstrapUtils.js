const path = require('path')
const logger = require('../utils/logger')
const config = require('../utils/config')
const packageJson = require("../package.json")

function modulePathResolver( handlersPath, route, apiDoc ) {
    const pathKey = route.openApiRoute.substring(route.basePath.length)
    const schema = apiDoc.paths[pathKey][route.method.toLowerCase()]
    const controller = schema.tags[0]
    const method = schema['operationId']
    const modulePath = path.join(handlersPath, controller)
    const handler = require(modulePath)
    if (handler[method] === undefined) {
      throw new Error(
        `Could not find a [${method}] function in ${modulePath} when trying to route [${route.method} ${route.expressRoute}].`,
      )
    }
    return handler[method]
}

function buildResponseValidationConfig() {
    if ( config.settings.responseValidation == "logOnly" ){
        return {
            onError: (error, body, req) => {
                logger.writeError('rest', 'responseValidation', {
                    error,
                    request: logger.serializeRequest(req),
                    body
                })
            }
        }
    }
    else {
        return false
    }
}

function logAppConfig() {
    logger.writeInfo('bootstrapUtils', 'starting bootstrap', {
      version: packageJson.version,
      env: logger.serializeEnvironment(),
      dirname: __dirname,
      cwd: process.cwd()
    })
    logger.writeInfo('bootstrapUtils', 'configuration', config)
  
    return config
}
  
module.exports = {
    modulePathResolver,
    buildResponseValidationConfig,
    logAppConfig
}