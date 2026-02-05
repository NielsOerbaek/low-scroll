#!/usr/bin/env bash
set -euo pipefail

REMOTE="ig-sub"
REMOTE_DIR="/opt/ig-sub"

echo "==> Syncing to $REMOTE:$REMOTE_DIR..."
rsync -az --delete \
  --exclude '.env' \
  --exclude 'data/' \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude '__pycache__/' \
  --exclude '.pytest_cache/' \
  --exclude '*.pyc' \
  ./ "$REMOTE:$REMOTE_DIR/"

echo "==> Rebuilding and restarting containers..."
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose up -d --build"

echo "==> Waiting for containers to start..."
sleep 3
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose ps"

echo "==> Done!"
