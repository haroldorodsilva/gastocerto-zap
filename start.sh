#!/bin/bash

# 🚀 Script de Inicialização Rápida - GastoCerto ZAP
# Autor: Sistema
# Data: 14/12/2025

set -e

echo "🚀 ========================================="
echo "   GASTOCERTO ZAP - Inicialização"
echo "========================================="
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função para verificar comando
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 não encontrado. Por favor, instale: $2${NC}"
        exit 1
    else
        echo -e "${GREEN}✅ $1 encontrado${NC}"
    fi
}

# Função para verificar se porta está em uso
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null ; then
        echo -e "${YELLOW}⚠️  Porta $1 já está em uso${NC}"
        return 1
    else
        echo -e "${GREEN}✅ Porta $1 disponível${NC}"
        return 0
    fi
}

echo "📋 Verificando dependências..."
echo ""
check_command "node" "https://nodejs.org/"
check_command "npm" "https://nodejs.org/"
check_command "docker" "https://docs.docker.com/get-docker/"
check_command "docker-compose" "https://docs.docker.com/compose/install/"

echo ""
echo "🔍 Verificando portas..."
echo ""
check_port 3000 || echo -e "${YELLOW}   Servidor NestJS já rodando?${NC}"
check_port 5432 || echo -e "${YELLOW}   PostgreSQL já rodando?${NC}"
check_port 6379 || echo -e "${YELLOW}   Redis já rodando?${NC}"

echo ""
echo "📝 Verificando arquivo .env..."
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  Arquivo .env não encontrado!${NC}"
    echo "   Criando a partir do .env.example..."
    cp .env.example .env
    echo -e "${GREEN}✅ Arquivo .env criado${NC}"
    echo -e "${YELLOW}⚠️  ATENÇÃO: Configure suas chaves de API no arquivo .env${NC}"
    echo ""
    read -p "Pressione ENTER para continuar ou Ctrl+C para sair e configurar..."
else
    echo -e "${GREEN}✅ Arquivo .env encontrado${NC}"
fi

echo ""
echo "📦 Instalando dependências..."
if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✅ Dependências instaladas${NC}"
else
    echo -e "${GREEN}✅ Dependências já instaladas (node_modules existe)${NC}"
fi

echo ""
echo "🐳 Iniciando containers (PostgreSQL + Redis)..."
docker-compose up -d

echo ""
echo "⏳ Aguardando containers iniciarem (5 segundos)..."
sleep 5

echo ""
echo "🗄️  Verificando status dos containers..."
docker-compose ps

echo ""
echo "🔄 Aplicando migrations..."
npx prisma migrate dev --name init

echo ""
echo "🎨 Gerando Prisma Client..."
npx prisma generate

echo ""
echo "✅ ========================================="
echo "   INICIALIZAÇÃO CONCLUÍDA!"
echo "========================================="
echo ""
echo "🎯 Próximos passos:"
echo ""
echo "1. Iniciar servidor:"
echo "   ${GREEN}npm run start:dev${NC}"
echo ""
echo "2. Gerar QR Code do WhatsApp:"
echo "   ${GREEN}curl http://localhost:3000/api/sessions/whatsapp/qr${NC}"
echo "   ou abra: ${GREEN}http://localhost:3000/api/sessions/whatsapp/qr${NC}"
echo ""
echo "3. Escanear QR Code com WhatsApp:"
echo "   Configurações > Dispositivos Conectados > Conectar Dispositivo"
echo ""
echo "4. Enviar mensagem de teste:"
echo "   Envie '${GREEN}Olá${NC}' para o número conectado"
echo ""
echo "📊 Ferramentas úteis:"
echo ""
echo "   • Ver banco: ${GREEN}npx prisma studio${NC}"
echo "   • Logs containers: ${GREEN}docker-compose logs -f${NC}"
echo "   • Parar containers: ${GREEN}docker-compose down${NC}"
echo ""
echo "📚 Documentação completa: ${GREEN}./INICIAR.md${NC}"
echo ""
