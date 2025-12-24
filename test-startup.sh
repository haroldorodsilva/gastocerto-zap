#!/bin/bash

echo "🧪 Testando inicialização do gastocerto-zap..."
echo ""

# Limpar processos anteriores
pkill -f "nest start" 2>/dev/null || true
sleep 2

# Iniciar servidor em background
echo "▶️  Iniciando servidor..."
npm run start:dev > /tmp/gastocerto-zap-startup.log 2>&1 &
SERVER_PID=$!

echo "PID do servidor: $SERVER_PID"
echo ""

# Aguardar inicialização (max 30 segundos)
echo "⏳ Aguardando inicialização..."
for i in {1..30}; do
  if grep -q "SessionManagerService initialized" /tmp/gastocerto-zap-startup.log 2>/dev/null; then
    echo "✅ SessionManagerService inicializado!"
    break
  fi

  if grep -q "NestApplication successfully started" /tmp/gastocerto-zap-startup.log 2>/dev/null; then
    echo "✅ Aplicação iniciada com sucesso!"
    break
  fi

  if grep -qi "error" /tmp/gastocerto-zap-startup.log 2>/dev/null; then
    echo "❌ Erro detectado durante inicialização!"
    echo ""
    echo "=== ÚLTIMAS 50 LINHAS DO LOG ==="
    tail -50 /tmp/gastocerto-zap-startup.log
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi

  echo -n "."
  sleep 1
done

echo ""
echo ""

# Verificar se servidor está rodando
if ps -p $SERVER_PID > /dev/null; then
  echo "✅ Servidor está rodando (PID: $SERVER_PID)"
  echo ""

  echo "=== ÚLTIMAS 30 LINHAS DO LOG ==="
  tail -30 /tmp/gastocerto-zap-startup.log
  echo ""

  echo "📋 Log completo em: /tmp/gastocerto-zap-startup.log"
  echo ""
  echo "🛑 Para parar o servidor: kill $SERVER_PID"
  echo "   ou execute: pkill -f 'nest start'"
else
  echo "❌ Servidor não está rodando!"
  echo ""
  echo "=== LOG COMPLETO ==="
  cat /tmp/gastocerto-zap-startup.log
  exit 1
fi
