#!/bin/bash

# Script to migrate data from KV to Turso
# Reads AUTH_TOKEN from .env.local if not set

if [ -z "$AUTH_TOKEN" ]; then
  if [ -f .env.local ]; then
    export $(grep AUTH_TOKEN .env.local | xargs)
  fi
fi

if [ -z "$AUTH_TOKEN" ]; then
  echo "Error: AUTH_TOKEN not found. Please set it as an environment variable or in .env.local"
  exit 1
fi

API_URL="${API_URL:-http://localhost:3001}"

echo "🚀 Migrating data from KV to Turso..."
echo "📍 API URL: $API_URL"
echo ""
echo "⚠️  WARNING: Make sure you have configured TURSO_DB_URL and TURSO_DB_AUTH_TOKEN"
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

curl -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$API_URL/v1/util/migrate/kv-to-turso" | jq .

echo "✅ Done!"