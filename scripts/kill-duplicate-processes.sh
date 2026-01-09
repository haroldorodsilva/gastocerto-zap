#!/bin/bash

echo "🔍 Procurando processos Node.js rodando..."
echo ""

# Listar todos os processos Node relacionados ao projeto
ps aux | grep -E "node|nest|ts-node" | grep -v grep

echo ""
echo "---"
echo ""
echo "🔪 Processos do projeto gastocerto-zap:"
ps aux | grep "gastocerto-zap" | grep -v grep

echo ""
echo "---"
echo ""
echo "💡 Para matar TODOS os processos Node.js (use com cuidado!):"
echo "   pkill -f node"
echo ""
echo "💡 Para matar apenas processos do NestJS:"
echo "   pkill -f nest"
echo ""
echo "💡 Para matar processo específico por PID:"
echo "   kill -9 <PID>"
echo ""

# Verificar se há Docker containers rodando
echo "🐳 Verificando containers Docker..."
docker ps | grep gastocerto

echo ""
echo "💡 Para parar containers Docker:"
echo "   docker-compose down"
