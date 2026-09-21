-- PowerSync bucket storage: its own database (service.yaml `storage`
-- points here). The service auto-migrates its own bucket tables on start.
-- Runs on first `docker compose up` (the postgres image executes
-- /docker-entrypoint-initdb.d/* in alphabetical order, against the
-- POSTGRES_DB database — which this statement does not touch).
CREATE DATABASE nextdo_powersync;
