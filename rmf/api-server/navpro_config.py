# NavPro configuration for the rmf-web api-server.
#
# Loaded via RMF_API_SERVER_CONFIG (a python module exporting `config`).
# Key layout follows upstream api_server/default_config.py at the pinned ref
# (see Dockerfile); all keys are required unless upstream marks them optional.
#
# Auth: tokens are issued by the NavPro Platform API (our own RS256 keypair),
# NOT by the api-server. This service only verifies them:
#   - RS256 public key mounted read-only at /keys/jwt-public.pem
#   - aud must be "rmf_api_server", iss must be "navpro-platform"
# Tokens must carry a `preferred_username` claim (used for the api-server's
# internal RBAC user records).

import os

_use_sim_time = os.environ.get("USE_SIM_TIME", "false").lower() in (
    "1",
    "true",
    "yes",
)

config = {
    # Bind on all interfaces of the shared rmf-core network namespace; the
    # compose bridge network is the isolation boundary (port never published).
    "host": "0.0.0.0",
    "port": int(os.environ.get("RMF_API_SERVER_PORT", "8000")),
    # Dedicated `rmf_api` database on the shared postgres service, e.g.
    # postgres://rmf_api:<password>@postgres:5432/rmf_api
    "db_url": os.environ["RMF_API_SERVER_DB_URL"],
    # URL the Platform API proxies this server on (used for OpenAPI docs).
    "public_url": os.environ.get(
        "RMF_API_SERVER_PUBLIC_URL", "http://localhost:8000"
    ),
    "cache_directory": os.environ.get(
        "RMF_API_SERVER_CACHE_DIR", "/rmf/api-server/cache"
    ),
    "log_level": os.environ.get("RMF_API_SERVER_LOG_LEVEL", "INFO"),
    # Platform service account that is auto-granted admin on startup. The
    # Platform API mints its service token with this preferred_username.
    "builtin_admin": os.environ.get("RMF_API_SERVER_ADMIN", "navpro-platform"),
    # RS256 verification of NavPro platform tokens. jwt_public_key and
    # jwt_secret are mutually exclusive upstream, so jwt_secret must be None.
    "jwt_public_key": os.environ.get("JWT_PUBLIC_KEY_PATH", "/keys/jwt-public.pem"),
    "jwt_secret": None,
    # Documentation-only upstream; we are not an OIDC deployment.
    "oidc_url": None,
    "aud": os.environ.get("JWT_AUDIENCE", "rmf_api_server"),
    "iss": os.environ.get("JWT_ISSUER", "navpro-platform"),
    "preferred_username_claim_namespace": None,
    "ros_args": ["-p", "use_sim_time:=true"] if _use_sim_time else [],
    "timezone": os.environ.get("TZ", "UTC"),
}
