#!/bin/sh
set -e

MAX_RETRIES=15
RETRY=0

echo "🔄 Running database migrations..."
until npx prisma migrate deploy --schema=src/prisma/schema.prisma; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "❌ Database not available after $MAX_RETRIES attempts, starting app anyway..."
    break
  fi
  echo "⏳ Waiting for database... ($RETRY/$MAX_RETRIES)"
  sleep 3
done

echo "🌱 Running database seed (idempotent)..."
node dist/seed/seed.js || echo "⚠️  Seed failed (non-fatal), continuing..."

echo "🚀 Starting application..."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"
exec node dist/main.js
