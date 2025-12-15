#!/bin/bash

# Script para ativar sessão do Telegram
# Usage: ./scripts/activate-telegram-session.sh <SESSION_ID> <JWT_TOKEN>

SESSION_ID="${1:-774265d2-c55d-4d74-9dfe-40453c780112}"
JWT_TOKEN="${2:-eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYjEyMGVjNS0zY2ExLTRiNzItOTVlZC1mODBhZjY2MzJkYjIiLCJ1c2VybmFtZSI6Imhhcm9sZG9yb2RzaWx2YUBnbWFpbC5jb20iLCJpYXQiOjE3NjU0MjE3MzAsImV4cCI6MTc2NTQzNjEzMH0.Raz7j5jW-LbADfaJ4bvt28o2ylf180rqcLqiYaJua7nJ4z57Dl3y9mjb8gCg6gxEpL87VeKck0WAfZLDhpRRScTpMOT_OM3Aqvbty2ZpWK83W8ydwYXAhRMkF-1t5ahbMzqAIw2znrLfZ52TkMVqGz3ZuTr4EtXvpmiZvibgTz1ShNAacA4T_GPXVm1JrXZMmRRrRo9QfcoZ5KteLwTtuS7mW8UEUG2N7eq6G291kVFaqN7yhhltftQOfX6eYy4BpnWJ6a6x4bt1bsH6l1kyz7SptcZ3l9hHrbCNmbKMIsp_lNueSeu9a6PU_xfarIzeFyBf19p4rBi-m3bGIF14bQ}"

echo "🚀 Activating Telegram session..."
echo "   Session ID: $SESSION_ID"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "http://localhost:4444/telegram/${SESSION_ID}/activate" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
  echo "✅ Session activated successfully!"
  echo ""
  echo "Now send a message to your bot in Telegram and check the server logs."
else
  echo "❌ Failed to activate session (HTTP $HTTP_CODE)"
  echo ""
  echo "💡 Tips:"
  echo "   - Check if JWT token is valid"
  echo "   - Verify session ID exists"
  echo "   - Check server logs for errors"
fi
