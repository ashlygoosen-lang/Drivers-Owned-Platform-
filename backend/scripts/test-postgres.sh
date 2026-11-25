#!/usr/bin/env bash
# Run the whole API test suite against PostgreSQL + Redis (fresh database per test file).
#   PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=drop REDIS_URL=redis://127.0.0.1:6380 scripts/test-postgres.sh
set -euo pipefail
: "${PGHOST:?}"; : "${PGPORT:?}"; : "${PGUSER:?}"; : "${REDIS_URL:?}"
fail=0
for f in test/*.test.js; do
  db="drop_t_$(basename "$f" .test.js | tr - _)"
  psql -q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null
  redis-cli -u "$REDIS_URL" flushall >/dev/null
  if ! STAFF_MFA="${STAFF_MFA:-off}" DATABASE_URL="postgresql://$PGUSER@/$db?host=$PGHOST&port=$PGPORT" node --test --test-timeout=180000 "$f" > "/tmp/pgtest-$(basename "$f").log" 2>&1; then
    echo "FAIL $f"; fail=1
  else echo "ok   $f"; fi
done
exit $fail
