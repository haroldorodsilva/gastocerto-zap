#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx prisma migrate deploy --schema=src/prisma/schema.prisma

echo "🌱 Running database seed (idempotent)..."
node dist/seed/seed.js

echo "🚀 Starting application..."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
exec node dist/main.js
