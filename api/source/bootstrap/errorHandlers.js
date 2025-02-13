const logger = require('../utils/logger')
const smErrors = require('../utils/error')
const { serializeError } = require('../utils/serializeError')
const path = require('path')

function configureErrorHandlers(app) {
  // express-openapi-validator does not expose top-level HttpError in their index.js. 
  // We can get it from framework.types.js
  // CAUTION: We break here if express-openapi-validator changes this 
  const eovPath = path.dirname(require.resolve('express-openapi-validator'))
  const eovErrors = require(path.join(eovPath, 'framework', 'types.js'))
  app.use((err, req, res, next) => {
    if (!(err instanceof smErrors.SmError) && !(err instanceof eovErrors.HttpError)) {
      logger.writeError('rest', 'error', {
        request: logger.serializeRequest(req),
        error: serializeError(err)
      })
    }

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
}

module.exports = configureErrorHandlers
