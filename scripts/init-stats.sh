#!/bin/bash

# Script to initialize stats from existing messages
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

echo "📊 Initializing stats from existing messages..."
echo "📍 API URL: $API_URL"

curl -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$API_URL/v1/util/stats/initialize" | jq .

echo "✅ Done!"