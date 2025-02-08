::==============================================================================
:: STIGMAN_API_ADDRESS
::
::  | Default: "0.0.0.0" | The IP address on which the the API server will
::  listen
::
::  Affects: API
::==============================================================================
:: set STIGMAN_API_ADDRESS=

::==============================================================================
:: STIGMAN_API_MAX_JSON_BODY
::
::  | Default: "5242880" | The maximum size in bytes of the request body when
::  Content-Type is application/json
::
::  Affects: API
::==============================================================================
:: set STIGMAN_API_MAX_JSON_BODY=

::==============================================================================
:: STIGMAN_API_MAX_UPLOAD
::
::  | Default: "1073741824" | The maximum size in bytes of the file uploaded
::  with Content-Type multipart/form-data
::
::  Affects: API
::==============================================================================
:: set STIGMAN_API_MAX_UPLOAD=

::==============================================================================
:: STIGMAN_API_PORT
::
::  | Default: "54000" | The TCP port on which the server will listen
::
::  Affects: API
::==============================================================================
:: set STIGMAN_API_PORT=

::==============================================================================
:: STIGMAN_CLASSIFICATION
::
::  | Default: "U" | Sets the classification banner, if any. Available values:
::  "NONE" "U" "CUI" "C" "S" "TS" "SCI"
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_CLASSIFICATION=

::==============================================================================
:: STIGMAN_CLIENT_API_BASE
::
::  | Default: "./api" | The base URL for Client requests to the API relative to
::  the sever root at /
::
::  Affects: Client
::==============================================================================
:: set STIGMAN_CLIENT_API_BASE=

::==============================================================================
:: STIGMAN_CLIENT_DIRECTORY
::
::  | Default: "./clients" | The location of the web client files, relative to
::  the API source directory. Note that if running source from a clone of the
::  GitHub repository, the client is located at `../../clients` relative to the
::  API directory.
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_CLIENT_DIRECTORY=

::==============================================================================
:: STIGMAN_CLIENT_DISABLED
::
::  | Default: "false" | Whether to *not* serve the reference web client
::
::  Affects: Client
::==============================================================================
:: set STIGMAN_CLIENT_DISABLED=

::==============================================================================
:: STIGMAN_CLIENT_DISPLAY_APPMANAGERS
::
::  | Default:  "true" | Set to "false" to hide application manager names
::   along with their email addresses on the Stig-Manager home page.
::
::  Affects: Client
::==============================================================================
:: set STIGMAN_CLIENT_DISPLAY_APPMANAGERS=

::==============================================================================
:: STIGMAN_CLIENT_EXTRA_SCOPES
::
::  | No default. | A space separated list of OAuth2 scopes to request in
::  addition to "stig-manager:stig" "stig-manager:stig:read" "stig-
::  manager:collection" "stig-manager:user" "stig-manager:user:read" "stig-
::  manager:op". Some OIDC providers (Okta) generate a refresh token only if the
::  scope "offline_access" is requested
::
::  Affects: Client
::==============================================================================
:: set STIGMAN_CLIENT_EXTRA_SCOPES=

::==============================================================================
:: STIGMAN_CLIENT_ID
::
::  | Default: "stig-manager" | The OIDC clientId of the web client
::
::  Affects: Client
::==============================================================================
:: set STIGMAN_CLIENT_ID=

::==============================================================================
:: STIGMAN_CLIENT_OIDC_PROVIDER
::
::  | Default: Value of "STIGMAN_OIDC_PROVIDER" | Client override of the base
::  URL of the OIDC provider issuing signed JWTs for the API.  The string
::  "/.well-known/openid-configuration" will be appended by the client when
::  fetching metadata.
::
::  Affects: Client 
::==============================================================================
:: set STIGMAN_CLIENT_OIDC_PROVIDER=

::==============================================================================
:: STIGMAN_CLIENT_SCOPE_PREFIX
::
::  | No default. | String used as a prefix for each scope when authenticating
::  to the OIDC Provider. Some providers (Azure AD) expect scope requests in the
::  format "api://<application_id>/<scope>", where "api://<application_id>/" is
::  the required prefix.
::
::  Affects: Client
::==============================================================================
:: set STIGMAN_CLIENT_SCOPE_PREFIX=

::==============================================================================
:: STIGMAN_CLIENT_REFRESH_DISABLED
::
::  | Default: "false" | Whether the web client should use a provided refresh
::  token to update the access token
::
::  Affects: Client
::==============================================================================
:: set STIGMAN_CLIENT_REFRESH_DISABLED=

::==============================================================================
:: STIGMAN_CLIENT_WELCOME_IMAGE 
::
::  | No default. | The URL of an image hosted elsewhere that will be rendered
::  in the Home tab Welcome widget. The STIGMan app does not serve the image
::  itself, only the reference to it. The URL should be in relation to and
::  accessible from the client's browser. The image will be scaled to a max
::  width or height of 125 pixels - If no alternate image is specified, the seal
::  of the Department of the Navy (the project sponsor)  will be displayed.
::
::  Affects: Client Appearance
::==============================================================================
:: set STIGMAN_CLIENT_WELCOME_IMAGE =

::==============================================================================
:: STIGMAN_CLIENT_WELCOME_LINK
::
::  | No default. | Value of an optional link that will follow the Welcome
::  message in the Home tab Welcome widget.
::
::  Affects: Client Appearance
::==============================================================================
:: set STIGMAN_CLIENT_WELCOME_LINK=

::==============================================================================
:: STIGMAN_CLIENT_WELCOME_MESSAGE 
::
::  | No default. | Text that will be displayed in the Home tab Welcome widget.
::
::  Affects: Client Appearance     
::==============================================================================
:: set STIGMAN_CLIENT_WELCOME_MESSAGE =

::==============================================================================
:: STIGMAN_CLIENT_WELCOME_TITLE 
::
::  | Default: "Support" | The tile that will be displayed for the custom Home
::  tab Welcome message.
::
::  Affects: Client Appearance
::==============================================================================
:: set STIGMAN_CLIENT_WELCOME_TITLE =

::==============================================================================
:: STIGMAN_DB_HOST
::
::  | Default: "localhost" | The database hostname or IP from to the API server
::
::  Affects: API
::==============================================================================
:: set STIGMAN_DB_HOST=

::==============================================================================
:: STIGMAN_DB_MAX_CONNECTIONS
::
::  | Default: "25" | The maximum size of the database connection pool
::
::  Affects: API
::==============================================================================
:: set STIGMAN_DB_MAX_CONNECTIONS=

::==============================================================================
:: STIGMAN_DB_PASSWORD
::
::  | No default. | The password used to login to the database
::
::  Affects: API
::==============================================================================
:: set STIGMAN_DB_PASSWORD=

::==============================================================================
:: STIGMAN_DB_PORT
::
::  | Default: "3306" | The database TCP port relative to the API server
::
::  Affects: API          
::==============================================================================
:: set STIGMAN_DB_PORT=

::==============================================================================
:: STIGMAN_DB_SCHEMA
::
::  | Default: "stigman" | The schema where the STIG Manager object are found
::
::  Affects: API          
::==============================================================================
:: set STIGMAN_DB_SCHEMA=

::==============================================================================
:: STIGMAN_DB_TLS_CA_FILE
::
::  | No default. | A file/path relative to the API /tls directory that contains
::  the PEM encoded CA certificate used to sign the database TLS certificate.
::  Setting this variable enables TLS connections to the database.
::
::  Affects: API          
::==============================================================================
:: set STIGMAN_DB_TLS_CA_FILE=

::==============================================================================
:: STIGMAN_DB_TLS_CERT_FILE
::
::  | No default. | A file/path relative to the API /tls directory that contains
::  the PEM encoded Client certificate used when authenticating the database
::  client. Additionally requires setting values for "STIGMAN_DB_TLS_CA_FILE"
::  and "STIGMAN_DB_TLS_KEY_FILE".
::
::  Affects: API          
::==============================================================================
:: set STIGMAN_DB_TLS_CERT_FILE=

::==============================================================================
:: STIGMAN_DB_TLS_KEY_FILE
::
::  | No default. | A file/path relative to the API /tls directory that contains
::  the PEM encoded Client private key used when authenticating the database
::  client. Additionally requires setting values for "STIGMAN_DB_TLS_CA_FILE"
::  and "STIGMAN_DB_TLS_CERT_FILE".
::
::  Affects: API          
::==============================================================================
:: set STIGMAN_DB_TLS_KEY_FILE=

::==============================================================================
:: STIGMAN_DB_USER
::
::  | Default: "stigman" | The user account used to login to the database
::
::  Affects: API    
::==============================================================================
:: set STIGMAN_DB_USER=

::==============================================================================
:: STIGMAN_DOCS_DIRECTORY
::
::  | Default: "./docs" | The location of the documentation files, relative to
::  the API source directory. Note that if running source from a clone of the
::  GitHub repository, the docs are located at `../../docs/_build/html` relative
::  to the API directory.
::
::  Affects: API, documentation
::==============================================================================
:: set STIGMAN_DOCS_DIRECTORY=

::==============================================================================
:: STIGMAN_DOCS_DISABLED
::
::  | Default: "false" | Whether to *not* serve the project Documentation.
::  NOTE: If you choose to serve the Client from the API container but not the
::  Documentation, the links do the Docs on the home page will not work.
::
::  Affects: Documentation                
::==============================================================================
:: set STIGMAN_DOCS_DISABLED=

::==============================================================================
:: STIGMAN_EXPERIMENTAL_APPDATA
::
::  | Default:  "false" | Set to "true" to enable the experimental AppData
::  import/export API endpoints and User Interface.
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_EXPERIMENTAL_APPDATA=

::==============================================================================
:: STIGMAN_LOG_LEVEL
::
::  | Default: "3" | Controls the granularity of the generated log output, from
::  1 to 4. Each level is inclusive of the ones before it. Level 1 will log only
::  errors, level 2 includes warnings, level 3 includes status and transaction
::  logs, and level 4 includes debug-level logs
::
::  Affects: API
::==============================================================================
:: set STIGMAN_LOG_LEVEL=

::==============================================================================
:: STIGMAN_LOG_MODE
::
::  | Default: "combined" | Controls whether the logs will create one “combined”
::  log entry for http requests that includes both the request and response
::  information; or two separate log entries, one for the request and one for
::  the response, that can be correlated via a generated Request GUID in each
::  entry
::
::  Affects: API
::==============================================================================
:: set STIGMAN_LOG_MODE=

::==============================================================================
:: STIGMAN_JWT_ASSERTION_CLAIM
::
::  | Default: "jti" | The access token claim whose value is the OIDC provider's
::  Assertion ID. Updates to this value trigger the API to update a User's
::  "lastClaims" property. The claim MUST be a top-level claim and cannot be
::  nested.
::
::  Affects: API
::==============================================================================
:: set STIGMAN_JWT_ASSERTION_CLAIM=

::==============================================================================
:: STIGMAN_JWT_EMAIL_CLAIM
::
::  | Default: "email" | The access token claim whose value is the user's email
::  address
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_JWT_EMAIL_CLAIM=

::==============================================================================
:: STIGMAN_JWT_NAME_CLAIM
::
::  | Default: "name" | The access token claim whose value is the user's full
::  name
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_JWT_NAME_CLAIM=

::==============================================================================
:: STIGMAN_JWT_PRIVILEGES_CLAIM
::
::  | Default: "realm_access.roles" | The access token claim whose value is the
::  user’s privileges
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_JWT_PRIVILEGES_CLAIM=

::==============================================================================
:: STIGMAN_JWT_SCOPE_CLAIM
::
::  | Default: "scope" | The access token claim whose value is the user's
::  scopes. Some OIDC Providers (Okta, Azure AD) use the claim "scp" to
::  enumerate scopes
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_JWT_SCOPE_CLAIM=

::==============================================================================
:: STIGMAN_JWT_SERVICENAME_CLAIM
::
::  | Default: "clientId" | The access token claim whose value is the user's
::  client
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_JWT_SERVICENAME_CLAIM=

::==============================================================================
:: STIGMAN_JWT_USERNAME_CLAIM
::
::  | Default: "preferred_username" | The access token claim whose value is the
::  user's username
::
::  Affects: API, Client
::==============================================================================
:: set STIGMAN_JWT_USERNAME_CLAIM=

::==============================================================================
:: STIGMAN_OIDC_PROVIDER
::
::  | Default: "http://localhost:8080/auth/realms/stigman" | The base URL of the
::  OIDC provider issuing signed JWTs for the API.  The string "/.well-
::  known/openid-configuration" will be appended when fetching metadata.
::
::  Affects: API, Client     
::==============================================================================
:: set STIGMAN_OIDC_PROVIDER=

::==============================================================================
:: STIGMAN_SWAGGER_ENABLED
::
::  | Default: "false" | Whether to enable the SwaggerUI SPA at /api-docs
::
::  Affects: API
::==============================================================================
:: set STIGMAN_SWAGGER_ENABLED=

::==============================================================================
:: STIGMAN_SWAGGER_OIDC_PROVIDER
::
::  | Default: Value of "STIGMAN_OIDC_PROVIDER" | SwaggerUI override of the base
::  URL of the OIDC provider issuing signed JWTs for the API.  The string
::  "/.well-known/openid-configuration" will be appended by the SwaggerUI when
::  fetching metadata.
::
::  Affects: API  
::==============================================================================
:: set STIGMAN_SWAGGER_OIDC_PROVIDER=

::==============================================================================
:: STIGMAN_SWAGGER_REDIRECT
::
::  | Default: "http://localhost:54000/api-docs/oauth2-redirect.html" | The
::  redirect URL sent by SwaggerUI to the OIDC provider when authorizing
::
::  Affects: API
::==============================================================================
:: set STIGMAN_SWAGGER_REDIRECT=

::==============================================================================
:: STIGMAN_SWAGGER_SERVER
::
::  | Default: "http://localhost:54000/api" | The API server URL relative to the
::  SwaggerUI
::
::  Affects: API
::==============================================================================
:: set STIGMAN_SWAGGER_SERVER=

stig-manager-win.exe
