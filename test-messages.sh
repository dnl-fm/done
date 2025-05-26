#!/bin/bash

# Create messages that will go through various states today
AUTH_TOKEN="test_dashboard_token"
BASE_URL="http://localhost:3001/v1"

echo "Creating test messages..."

# Create some immediate messages (will transition through states quickly)
for i in {1..5}; do
  curl -X POST "$BASE_URL/messages/https://test$i.gotrequests.com" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"event": "test.immediate", "id": "'$i'", "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}'
  echo
done

# Create some scheduled messages for 30 seconds from now
for i in {6..10}; do
  curl -X POST "$BASE_URL/messages/https://test$i.gotrequests.com" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Delay: 30s" \
    -d '{"event": "test.scheduled", "id": "'$i'", "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}'
  echo
done

# Create a message that will fail (invalid URL)
curl -X POST "$BASE_URL/messages/https://invalid-domain-that-does-not-exist.test" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event": "test.fail", "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}'
echo

echo "Messages created. They should transition through states over the next minute."