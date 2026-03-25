#!/bin/bash
# Runs health check and saves JSON results to a log file.
# Intended to be called from system cron or CTO heartbeat.
#
# Usage: bash scripts/health-check-cron.sh
# Results: scripts/health-check-latest.json (overwritten each run)
#          scripts/health-check.log (appended)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_FILE="$SCRIPT_DIR/health-check-latest.json"
LOG_FILE="$SCRIPT_DIR/health-check.log"

cd "$PROJECT_DIR"

# Source environment (DATABASE_URL etc.)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running health check..." >> "$LOG_FILE"

# Run health check in JSON mode
if npx tsx scripts/health-check.ts --json > "$RESULTS_FILE" 2>> "$LOG_FILE"; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Health check passed" >> "$LOG_FILE"
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Health check found issues (exit code $?)" >> "$LOG_FILE"
fi
