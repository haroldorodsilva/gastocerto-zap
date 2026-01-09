#!/bin/bash

# Simular chamada do webchat
echo "🧪 Testando chamada webchat..."
echo ""

# Endpoint
ENDPOINT="https://zap.hlg.gastocerto.com.br/webchat/message"

# JWT token (você precisa pegar um token válido do seu teste)
# Este é apenas um exemplo - você precisa substituir por um token real
JWT_TOKEN="SEU_TOKEN_AQUI"

# Teste 1
echo "📤 Teste 1: gastei 50 reais na farmacia"
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "x-account: SEU_ACCOUNT_ID_AQUI" \
  -d '{"message":"gastei 50 reais na farmacia"}' \
  -v

echo ""
echo "---"
echo ""

# Teste 2
echo "📤 Teste 2: gastei 50 reais com comida"
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "x-account: SEU_ACCOUNT_ID_AQUI" \
  -d '{"message":"gastei 50 reais com comida"}' \
  -v
