'use strict';

const startTime = process.hrtime.bigint()
const logger = require('./utils/logger')
const smErrors = require('./utils/error')
const {serializeError} = require('./utils/serializeError')

// Start logging as early as we can
const packageJson = require("./package.json")
logger.writeInfo('index', 'starting', {
  version: packageJson.version,
  env: logger.serializeEnvironment(),
  dirname: __dirname,
  cwd: process.cwd()
})

const config = require('./utils/config')
logger.writeInfo('index','configuration', config)

const path = require('path')
const http = require('http')
const express = require('express')
const cors = require('cors');
const compression = require('compression')
const auth = require('./utils/auth')
const swaggerUi = require('swagger-ui-express')
const jsyaml = require('js-yaml');
const fs = require('fs')
const multer  = require('multer')
const writer = require('./utils/writer.js')
const OperationSvc = require(`./service/OperationService`)
const { middleware: openApiMiddleware, resolvers } = require('express-openapi-validator')
const db = require(`./service/utils`)
const depStatus = {
  db: 'waiting',
  auth: 'waiting'
}


// express-openapi-validator does not expose top-level HttpError in their index.js. 
// We can get it from framework.types.js
// CAUTION: We break here if express-openapi-validator changes this 
const eovPath = path.dirname(require.resolve('express-openapi-validator'))
const eovErrors = require(path.join(eovPath, 'framework', 'types.js'))


//Catch unhandled errors. 
process.on('uncaughtException', (err, origin) => {
  logger.writeError('app','uncaught', serializeError(err))
})
process.on('unhandledRejection', (reason, promise) => {
  logger.writeError('app','unhandled', {reason, promise})
})


// Express config
const app = express();
let storage =  multer.memoryStorage()
const upload = multer({ 
  storage,
  limits: {
    fileSize: parseInt(config.http.maxUpload)
  }
})
app.use(upload.single('importFile'))
app.use(express.urlencoded( {extended: true}))
app.use(express.json({
  strict: false, // allow root to be any JSON value, per https://datatracker.ietf.org/doc/html/rfc7159#section-2
  limit: parseInt(config.http.maxJsonBody)
})) //Handle JSON request body
app.use(cors())

app.use( logger.requestLogger )

// compress responses
app.use(compression({
  filter: (req, res) => {
    if (req.noCompression) {
      return false
    }
    return compression.filter(req, res)
  }
}))

// 503 service unavailable check
app.use((req, res, next) => {
  try {
    if ((depStatus.db === 'up' && depStatus.auth === 'up') || req.url.startsWith('/api/op/definition')) {
      next()
    }
    else {
      res.status(503).json({status: depStatus})
    }
  }
  catch(e) {
    next(e)
  }
})

app.use('/api', auth.validateToken)
app.use('/api', auth.setupUser)

const apiSpecPath = path.join(__dirname, './specification/stig-manager.yaml')
app.use( "/api", openApiMiddleware ({
  apiSpec: apiSpecPath,
  validateRequests: {
    coerceTypes: false,
    allowUnknownQueryParameters: false,
  },
  validateResponses: buildResponseValidationConfig(),
  validateApiSpec: true,
  $refParser: {
    mode: 'dereference',
  },
  operationHandlers: {
    basePath: path.join(__dirname, 'controllers'),
    resolver: modulePathResolver,
  },
  validateSecurity: {
    handlers:{
      oauth: auth.validateOauthSecurity 
    }
  },
  fileUploader: false
}))

// Express error handler
app.use((err, req, res, next) => {
  if (!(err instanceof smErrors.SmError) && !(err instanceof eovErrors.HttpError)) {
    logger.writeError('rest', 'error', {
      request: logger.serializeRequest(req),
      error: serializeError(err)
    })
  }
  // Expose selected error properties in the response
  res.errorBody = { error: err.message, code: err.code, detail: err.detail}
  if (err.status === 500 || !(err.status)) res.errorBody.stack = err.stack
  if (!res._headerSent) {
    res.status(err.status || 500).header(err.headers).json(res.errorBody)
  }
  else {
    res.write(JSON.stringify(res.errorBody) + '\n')
    res.end()
  }
})

run()

function run() {
  try {
    if (!config.client.disabled) {
      setupClient(app, config.client.directory)
      logger.writeDebug('index', 'client', {message: 'succeeded setting up client'})
    }
    else {
      logger.writeDebug('index', 'client', {message: 'client disabled'})
    }
    if (!config.docs.disabled) {
      // setup documentation route
      app.use('/docs', express.static(path.join(__dirname, config.docs.docsDirectory)))
      logger.writeDebug('index', 'client', {message: 'succeeded setting up documentation'})
    }
    else {
      logger.writeDebug('index', 'client', {message: 'documentation disabled'})
    }
    // Read and modify OpenAPI specification
    let spec = fs.readFileSync(apiSpecPath, 'utf8')
    let oasDoc = jsyaml.load(spec)
    // Replace with config values
    oasDoc.info.version = config.version
    oasDoc.servers[0].url = config.swaggerUi.server
    oasDoc.components.securitySchemes.oauth.openIdConnectUrl = `${config.client.authority}/.well-known/openid-configuration`
    config.definition = oasDoc

    if (config.swaggerUi.enabled) {
      app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(oasDoc, null, {
        oauth2RedirectUrl: config.swaggerUi.oauth2RedirectUrl,
        oauth: {
          usePkceWithAuthorizationCodeGrant: true
        }
      }))
      app.get(['/swagger.json','/openapi.json'], function(req, res) {
        res.json(oasDoc);
      })
      logger.writeDebug('index', 'client', {message: 'succeeded setting up swagger-ui'})
    }
    startServer(app)
  }
  catch (err) {
    logger.writeError(err.message);
    process.exit(1);
  }
}

function setupClient(app, directory) {
  try {
    const envJS = 
`
const STIGMAN = {
  Env: {
    version: "${config.version}",
    apiBase: "${config.client.apiBase}",
    welcome: {
      image: "${config.client.welcome.image}",
      title: "${config.client.welcome.title.replace(/"/g, '\\"')}",
      message: "${config.client.welcome.message.replace(/"/g, '\\"')}",
      link: "${config.client.welcome.link}"
    },
    commit: {
        branch: "${config.commit.branch}",
        sha: "${config.commit.sha}",
        tag: "${config.commit.tag}",
        describe: "${config.commit.describe}"
    },
    oauth: {
        authority:  "${config.client.authority}",
        clientId: "${config.client.clientId}",
        refreshToken: {
          disabled: ${config.client.refreshToken.disabled}
        },
        extraScopes: "${config.client.extraScopes ?? ''}",
        scopePrefix: "${config.client.scopePrefix ?? ''}"
    },
    experimental: {
      appData: "${config.experimental.appData}"
    }
  }
}    
`
    app.get('/js/Env.js', function (req, res) {
      req.component = 'static'
      writer.writeWithContentType(res, {payload: envJS, contentType: "application/javascript"})
    })
    logger.writeDebug('index', 'client', {client_static: path.join(__dirname, directory)})
    const expressStatic = express.static(path.join(__dirname, directory))
    app.use('/', (req, res, next) => {
      req.component = 'static'
      expressStatic(req, res, next)
    })
  }
  catch (err) {
    logger.writeError('index', 'client', {message: err.message, stack: err.stack})
  }
}

function startServer(app) {
  const server = http.createServer(app)

  const onListenError = (e) => {
    logger.writeError('index', 'shutdown', {message:`Server failed establishing or while listening on port ${config.http.port}`, error: serializeError(e)})
    process.exit(1)  
  }
  server.on('error', onListenError)
  
  server.listen(config.http.port, async function () {
    server.removeListener('error', onListenError)
    logger.writeInfo('index', 'listening', {
      port: config.http.port,
      api: '/api',
      client: config.client.disabled ? undefined : '/',
      documentation: config.docs.disabled ? undefined : '/docs',
      swagger: config.swaggerUi.enabled ? '/api-docs' : undefined
    })
    try {
      await Promise.all([auth.initializeAuth(depStatus), db.initializeDatabase(depStatus)])
    }
    catch (e) {
      logger.writeError('index', 'shutdown', {message:'Failed to setup dependencies', error: serializeError(e)})
      process.exit(1) 
    }
  
    // Set/change classification if indicated
    if (config.settings.setClassification) {
      await OperationSvc.setConfigurationItem('classification', config.settings.setClassification)
    }
  
    const endTime = process.hrtime.bigint()
    logger.writeInfo('index', 'started', {
      durationS: Number(endTime - startTime) / 1e9
    })
  })
}

function modulePathResolver( handlersPath, route, apiDoc ) {
  const pathKey = route.openApiRoute.substring(route.basePath.length);
  const schema = apiDoc.paths[pathKey][route.method.toLowerCase()];
  const controller = schema.tags[0]
  const method = schema['operationId']
  const modulePath = path.join(handlersPath, controller);
  const handler = require(modulePath);
  if (handler[method] === undefined) {
    throw new Error(
      `Could not find a [${method}] function in ${modulePath} when trying to route [${route.method} ${route.expressRoute}].`,
    );
  }
  return handler[method];
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