#!/bin/bash
# Pre-Deployment Script para Coolify v4
# Garante que instância antiga seja parada antes da nova subir

set -e  # Para em caso de erro

echo "🔍 [Pre-Deploy] Verificando containers em execução..."

# Tentar encontrar containers antigos do projeto
# Adapte o filtro conforme labels que o Coolify usa
OLD_CONTAINERS=$(docker ps \
  --filter "ancestor=gastocerto-zap" \
  --filter "status=running" \
  --format "{{.ID}} {{.Names}}" 2>/dev/null || true)

if [ -z "$OLD_CONTAINERS" ]; then
  echo "✅ [Pre-Deploy] Nenhum container antigo encontrado"
  exit 0
fi

echo "📋 [Pre-Deploy] Containers encontrados:"
echo "$OLD_CONTAINERS"

# Contar containers
COUNT=$(echo "$OLD_CONTAINERS" | wc -l | tr -d ' ')

if [ "$COUNT" -eq "0" ]; then
  echo "✅ [Pre-Deploy] Nenhum container para parar"
  exit 0
fi

echo "🔴 [Pre-Deploy] Parando $COUNT container(s) antigo(s)..."

# Parar cada container com timeout de 30s (permite graceful shutdown)
echo "$OLD_CONTAINERS" | while read -r container_id container_name; do
  if [ ! -z "$container_id" ]; then
    echo "   ⏹️  Parando $container_name ($container_id)..."
    docker stop -t 30 "$container_id" 2>/dev/null || {
      echo "   ⚠️  Aviso: Não foi possível parar $container_id gracefully"
    }
  fi
done

echo "⏳ [Pre-Deploy] Aguardando 10s para garantir desconexão completa..."
sleep 10

echo "✅ [Pre-Deploy] Containers antigos parados. Pronto para deploy!"
exit 0
