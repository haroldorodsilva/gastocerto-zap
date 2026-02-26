#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx prisma migrate deploy --schema=src/prisma/schema.prisma

echo "🌱 Running database seed (idempotent)..."
node dist/seed/seed.js

echo "🚀 Starting application..."
exec node dist/main.js
