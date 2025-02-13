const express = require('express')
const path = require('path')
const writer = require('../utils/writer')
const logger = require('../utils/logger')
const config = require('../utils/config')

function serveClient(app) {

    if (config.client.disabled) {
        logger.writeDebug('serveClient', 'client', {message: 'client disabled'})
        return
    }
    try {
        serveClientEnv(app)
        serveStaticFiles(app)
        logger.writeDebug('serveClient', 'client', { message: 'succeeded setting up client' })
    }
    catch (err) {
        logger.writeError('serveClient', 'client', {message: err.message, stack: err.stack})
    }
}

function getClientEnv(){
    const envJS = 
    `const STIGMAN = {
        Env: {
            version: "${config.version}",
            apiBase: "${config.client.apiBase}",
            displayAppManagers: ${config.client.displayAppManagers},
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
    }`
    return envJS
}

function serveClientEnv(app){
    const envJS = getClientEnv()
    app.get('/js/Env.js', function (req, res) {
        req.component = 'static'
        writer.writeWithContentType(res, { payload: envJS, contentType: "application/javascript" })
    })
}

function serveStaticFiles(app){
    const staticPath = path.join(__dirname, "../",  config.client.directory)
    logger.writeDebug('serveStaticFiles', 'client', {client_static: staticPath})
    const expressStatic = express.static(staticPath)

    app.use('/', (req, res, next) => {
        req.component = 'static'
        expressStatic(req, res, next)
    })
}

module.exports = {
    serveClient,
}
