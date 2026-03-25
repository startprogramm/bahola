#!/bin/bash
set -e

cd /home/ubuntu/bahola/production

echo "=== Building bahola.uz ==="
NEXT_PUBLIC_APP_MODE=bahola NEXT_DIST_DIR=.next-bahola npm run build

echo ""
echo "=== Building maktab.bahola.uz ==="
NEXT_PUBLIC_APP_MODE=maktab NEXT_DIST_DIR=.next-maktab npm run build

echo ""
echo "=== Restarting PM2 processes ==="
pm2 delete assessment-checker maktab 2>/dev/null || true
pm2 start ecosystem.config.js

echo ""
echo "=== Done ==="
pm2 list
