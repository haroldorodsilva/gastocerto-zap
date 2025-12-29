#!/bin/bash

# Script para forçar reautenticação e salvar credenciais

SESSION_ID="session-1767014152027-i0i07sr"
API_URL="http://localhost:4444"
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYjEyMGVjNS0zY2ExLTRiNzItOTVlZC1mODBhZjY2MzJkYjIiLCJ1c2VybmFtZSI6Imhhcm9sZG9yb2RzaWx2YUBnbWFpbC5jb20iLCJpYXQiOjE3NjcwMTI4MDEsImV4cCI6MTc2NzAyNzIwMX0.GsUbdSvfd6Ze9LUfKS2F7EhbYu7M7XLE7JZ04h5jOo3-dbwhdhg9RSDZkfzfIDvDZj7XgiK3J4nYvRXbAeEPPM2QJBqixfS57Ys7wNppijH3eOQpts8gB5mTaXWdxpMj6pvoyX8ZKsdV_ro_A7zlSec9BhdxUqILwyDnnijkJvS_dI0R4SjNX5Ga2Pk8CZoMXHO7hzsLkFdXr3CeXvUE5QyeY9NeZ8U0I5rJfeSEC7rx0MjLCL1CKWqBvNBuydpwyAltbiUn-OSPEVhCDMdWCeWcpHjry-CZbEpa9QN7j6PZe_Exmxv34_4U-KuHxjeX-aySxBwLp_8ncXKB446PYg"

echo "🔄 Reautenticando sessão para salvar credenciais..."
echo ""

echo "1️⃣ Resetando autenticação..."
curl -X POST "${API_URL}/whatsapp/${SESSION_ID}/reset-auth" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"

echo ""
echo ""
echo "⏳ Aguardando 3 segundos..."
sleep 3

echo ""
echo "2️⃣ Ativando sessão novamente..."
curl -X POST "${API_URL}/whatsapp/${SESSION_ID}/activate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"

echo ""
echo ""
echo "✅ Comandos executados!"
echo ""
echo "📱 PRÓXIMOS PASSOS:"
echo "   1. Acesse: http://localhost:4444/whatsapp/${SESSION_ID}/qr"
echo "   2. Escaneie o QR code no seu celular"
echo "   3. Aguarde no terminal do servidor o log:"
echo "      💾 Credentials saved to database for session: ${SESSION_ID}"
echo ""
echo "   Quando aparecer esse log, as credenciais estarão salvas!"
echo "   Aí pode reiniciar o servidor e a sessão vai reconectar automaticamente 🚀"
