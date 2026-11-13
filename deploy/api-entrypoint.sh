#!/bin/sh
set -e
cd /app/api
echo "› Syncing database schema"
npx prisma db push --skip-generate
echo "› Applying constraints"
npx prisma db execute --file prisma/constraints.sql --schema prisma/schema.prisma
if [ "${SEED_ON_START}" = "true" ]; then
  echo "› Seeding demo data"
  npx ts-node prisma/seed.ts
fi
exec node dist/main.js
