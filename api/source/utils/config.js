const package = require("../package.json")

const config = {
    version: package.version,
    commit: {
        branch: process.env.COMMIT_BRANCH || 'na',
        sha: process.env.COMMIT_SHA || 'na',
        tag: process.env.COMMIT_TAG || 'na',
        describe: process.env.COMMIT_DESCRIBE || 'na'
    },
    settings: {
        setClassification: process.env.STIGMAN_CLASSIFICATION,
        lastAccessResolution: 60,
        // Supported STIGMAN_DEV_RESPONSE_VALIDATION values: 
        // "logOnly" (logs failing response, but still sends them) 
        // "none"(no validation performed)
        responseValidation: process.env.STIGMAN_DEV_RESPONSE_VALIDATION || "none"
    },
    client: {
        clientId: process.env.STIGMAN_CLIENT_ID || "stig-manager",
        displayAppManagers: process.env.STIGMAN_CLIENT_DISPLAY_APPMANAGERS || "true",
        authority: process.env.STIGMAN_CLIENT_OIDC_PROVIDER || process.env.STIGMAN_OIDC_PROVIDER || "http://localhost:8080/realms/stigman",
        apiBase: process.env.STIGMAN_CLIENT_API_BASE || "api",
        disabled: process.env.STIGMAN_CLIENT_DISABLED === "true",
        directory: process.env.STIGMAN_CLIENT_DIRECTORY || '../../client/dist',
        extraScopes: process.env.STIGMAN_CLIENT_EXTRA_SCOPES,
        scopePrefix: process.env.STIGMAN_CLIENT_SCOPE_PREFIX,
        refreshToken: {
            disabled: process.env.STIGMAN_CLIENT_REFRESH_DISABLED ? process.env.STIGMAN_CLIENT_REFRESH_DISABLED === "true" : false,
        },
        welcome: {
            image: process.env.STIGMAN_CLIENT_WELCOME_IMAGE || "",
            message: process.env.STIGMAN_CLIENT_WELCOME_MESSAGE || "",
            title: process.env.STIGMAN_CLIENT_WELCOME_TITLE || "",
            link: process.env.STIGMAN_CLIENT_WELCOME_LINK || ""
        }
    },
    docs: {
        disabled: process.env.STIGMAN_DOCS_DISABLED  === "true",
        docsDirectory: process.env.STIGMAN_DOCS_DIRECTORY || '../../docs/_build/html',
    },    
    http: {
        address: process.env.STIGMAN_API_ADDRESS || "0.0.0.0",
        port: process.env.STIGMAN_API_PORT || 54000,
        maxJsonBody: process.env.STIGMAN_API_MAX_JSON_BODY || "31457280",
        maxUpload: process.env.STIGMAN_API_MAX_UPLOAD || "1073741824"
    },
    database: {
        host: process.env.STIGMAN_DB_HOST || "localhost",
        port: process.env.STIGMAN_DB_PORT || 3306,
        schema: process.env.STIGMAN_DB_SCHEMA || "stigman",
        username: process.env.STIGMAN_DB_USER || "stigman",
        password: process.env.STIGMAN_DB_PASSWORD,
        maxConnections: process.env.STIGMAN_DB_MAX_CONNECTIONS || 25,
        tls: {
            ca_file: process.env.STIGMAN_DB_TLS_CA_FILE,
            cert_file: process.env.STIGMAN_DB_TLS_CERT_FILE,
            key_file: process.env.STIGMAN_DB_TLS_KEY_FILE
        },
        revert: process.env.STIGMAN_DB_REVERT === "true",
        toJSON: function () {
            let {password, ...props} = this
            props.password = !!password
            return props          
        }
    },
    swaggerUi: {
        enabled: process.env.STIGMAN_SWAGGER_ENABLED === "true", 
        authority: process.env.STIGMAN_SWAGGER_OIDC_PROVIDER || process.env.STIGMAN_SWAGGER_AUTHORITY || process.env.STIGMAN_OIDC_PROVIDER || "http://localhost:8080/auth/realms/stigman", 
        server: process.env.STIGMAN_SWAGGER_SERVER || "http://localhost:54000/api",
        oauth2RedirectUrl: process.env.STIGMAN_SWAGGER_REDIRECT || "http://localhost:54000/api-docs/oauth2-redirect.html"
    },
    oauth: {
        authority: process.env.STIGMAN_OIDC_PROVIDER || process.env.STIGMAN_API_AUTHORITY || "http://localhost:8080/realms/stigman",
        claims: {
            scope: process.env.STIGMAN_JWT_SCOPE_CLAIM || "scope",
            username: process.env.STIGMAN_JWT_USERNAME_CLAIM,
            servicename: process.env.STIGMAN_JWT_SERVICENAME_CLAIM,
            name: process.env.STIGMAN_JWT_NAME_CLAIM || process.env.STIGMAN_JWT_USERNAME_CLAIM || "name",
            privileges: formatChain(process.env.STIGMAN_JWT_PRIVILEGES_CLAIM || "realm_access.roles"),
            privilegesPath: process.env.STIGMAN_JWT_PRIVILEGES_CLAIM || "realm_access.roles",
            email: process.env.STIGMAN_JWT_EMAIL_CLAIM || "email",
            assertion: process.env.STIGMAN_JWT_ASSERTION_CLAIM || "jti"
        }
    },
    log: {
        level: parseInt(process.env.STIGMAN_LOG_LEVEL) || 3,
        mode: process.env.STIGMAN_LOG_MODE || 'combined',
        optStats: process.env.STIGMAN_DEV_LOG_OPT_STATS === "true"
    },
    experimental: {
        appData: process.env.STIGMAN_EXPERIMENTAL_APPDATA === "true"
    }
}

function formatChain(path) {
    const components = path?.split('.')
    if (components?.length === 1) return path
    for (let x=0; x < components.length; x++) {
      components[x] = `['${components[x]}']`
    }
    return components.join('?.')
  }
  
module.exports = config