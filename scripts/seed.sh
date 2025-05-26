#!/bin/bash

# Script to seed the database with test data
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
COUNT="${1:-100}"

echo "🌱 Seeding database with $COUNT messages..."
echo "📍 API URL: $API_URL"

curl -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"count\":$COUNT}" \
  "$API_URL/v1/util/seed" | jq .

echo "✅ Done!"