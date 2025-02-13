const logger = require('../utils/logger')
const auth = require('../utils/auth')
const db = require('../service/utils')
const { serializeError } = require('../utils/serializeError')

let depStatus = {
  db: 'waiting',
  auth: 'waiting'
}

async function initializeDependencies() {
  try {
      await Promise.all([
          auth.initializeAuth(setDepStatus),
          db.initializeDatabase(setDepStatus)
      ])
  } catch (e) {
    logger.writeError('dependencies', 'shutdown', {message:'Failed to setup dependencies', error: serializeError(e)})
    process.exit(1)
  }
}

function setDepStatus(service, status) {
  if (depStatus.hasOwnProperty(service)) {
    depStatus[service] = status
  } else {
    throw new Error(`Service ${service} is not recognized in depStatus`)
  }
}

function getDepStatus() {
  return depStatus
}

module.exports = {
  getDepStatus,
  initializeDependencies
}
