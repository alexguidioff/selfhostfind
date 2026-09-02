#!/bin/sh
# Dumps the database, verifies the dump is actually restorable (not just "gzip -t passes"),
# prunes old backups, and pings a heartbeat/alerts on failure. Runs inside the `backup`
# docker-compose service, which uses the same postgres:16-alpine image as `db` — so pg_dump
# and psql are always version-matched to the server without us tracking that separately.
#
# A backup nobody has restored is unverified insurance: this script restores every dump it
# makes into a throwaway database on the same server (created and dropped within seconds)
# before calling the backup good.
set -eu
set -o pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$BACKUP_DIR/selfhostfind-$TIMESTAMP.sql.gz"
VERIFY_DB="selfhostfind_backup_verify"

# DATABASE_URL points at the app's own database (e.g. .../selfhostfind); ADMIN_URL swaps the
# path to Postgres's always-present `postgres` database, which we need a connection to in
# order to CREATE/DROP the throwaway verification database. Assumes no query string suffix
# on DATABASE_URL, which holds for the URL this project's own docker-compose.yml builds.
ADMIN_URL=$(echo "$DATABASE_URL" | sed -E 's#/[^/]+$#/postgres#')
VERIFY_URL=$(echo "$DATABASE_URL" | sed -E "s#/[^/]+\$#/$VERIFY_DB#")

send_alert() {
  level="$1"; title="$2"; message="$3"
  echo "[backup:alert:$level] $title — $message"
  [ -z "${ALERT_WEBHOOK_URL:-}" ] && return 0
  case "${ALERT_WEBHOOK_FORMAT:-generic}" in
    slack)
      wget -q -T 10 --header="Content-Type: application/json" \
        --post-data="{\"text\":\"[$level] $title\\n$message\"}" -O /dev/null "$ALERT_WEBHOOK_URL" || true ;;
    discord)
      wget -q -T 10 --header="Content-Type: application/json" \
        --post-data="{\"content\":\"[$level] $title\\n$message\"}" -O /dev/null "$ALERT_WEBHOOK_URL" || true ;;
    ntfy)
      wget -q -T 10 --header="Title: $title" --header="Priority: urgent" --header="Tags: rotating_light" \
        --post-data="$message" -O /dev/null "$ALERT_WEBHOOK_URL" || true ;;
    *)
      wget -q -T 10 --header="Content-Type: application/json" \
        --post-data="{\"title\":\"$title\",\"message\":\"$message\",\"level\":\"$level\",\"source\":\"selfhostfind-backup\"}" \
        -O /dev/null "$ALERT_WEBHOOK_URL" || true ;;
  esac
}

# Catch-all: with `set -eu -o pipefail`, ANY unexpected failure anywhere in this script (a
# psql command during restore-verification, an unanticipated error) lands here rather than
# silently exiting without ever calling send_alert. ALERTED guards against a duplicate,
# less-specific alert when a branch below has already sent a more useful message.
ALERTED=0
on_exit() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$ALERTED" -eq 0 ]; then
    send_alert error "Database backup job failed unexpectedly" "Exited with status $status — see job logs for the actual command output."
  fi
  psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS $VERIFY_DB;" >/dev/null 2>&1 || true
}
trap on_exit EXIT

fail() {
  level="$1"; title="$2"; message="$3"
  send_alert "$level" "$title" "$message"
  ALERTED=1
  exit 1
}

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping database to $FILE"
if ! pg_dump "$DATABASE_URL" | gzip > "$FILE"; then
  rm -f "$FILE"
  fail error "Database backup failed" "pg_dump exited non-zero — see job logs."
fi

if [ ! -s "$FILE" ]; then
  rm -f "$FILE"
  fail error "Database backup produced an empty file" "$FILE was created but is 0 bytes."
fi

if ! gzip -t "$FILE"; then
  fail error "Database backup failed integrity check" "$FILE did not pass 'gzip -t'."
fi

echo "[backup] verifying restorability into throwaway database $VERIFY_DB"
if ! psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $VERIFY_DB;" ||
   ! psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $VERIFY_DB;"; then
  fail error "Database backup restore-verification could not start" \
    "Failed to create the throwaway verification database $VERIFY_DB — see job logs. The backup file itself was kept."
fi

if ! gunzip -c "$FILE" | psql "$VERIFY_URL" -v ON_ERROR_STOP=1 -q > /tmp/restore.log 2>&1; then
  echo "[backup] restore verification failed, see below" >&2
  cat /tmp/restore.log >&2
  fail error "Database backup restore-verification failed" \
    "$FILE could not be restored into a throwaway database. The file was kept for manual inspection, but treat it as unverified."
fi

ROW_COUNT=$(psql "$VERIFY_URL" -tAc 'SELECT count(*) FROM "Repository";' 2>/dev/null || echo "?")
echo "[backup] restore verification OK ($ROW_COUNT repository rows)"

# Retention: delete local backups older than RETENTION_DAYS. Off-box copies (another disk,
# another machine, object storage) are this project's responsibility to add, not this
# script's — see README "Backups" for a one-line rsync/rclone example.
find "$BACKUP_DIR" -name 'selfhostfind-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  wget -q -T 10 -O /dev/null "$BACKUP_HEARTBEAT_URL" || true
fi

echo "[backup] done: $(du -h "$FILE" | cut -f1) at $FILE"
