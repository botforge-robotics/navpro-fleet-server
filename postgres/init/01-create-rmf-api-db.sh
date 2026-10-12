#!/bin/sh
# Creates the separate database used by rmf_api_server (its own ORM/tables),
# keeping it isolated from the platform's system-of-record schema.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE rmf_api;
    GRANT ALL PRIVILEGES ON DATABASE rmf_api TO $POSTGRES_USER;
EOSQL
