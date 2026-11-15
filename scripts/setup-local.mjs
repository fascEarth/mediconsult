// Creates api/.env for local development (only if it doesn't exist yet).
// Usage: node scripts/setup-local.mjs [postgres-url]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const target = 'api/.env';
if (existsSync(target)) {
  console.log(`✓ ${target} already exists — leaving it unchanged.`);
  process.exit(0);
}
const dbUrl = process.argv[2] || process.env.DATABASE_URL || 'postgresql://medi:medi@localhost:5433/mediconsult';
let env = readFileSync('.env.example', 'utf8')
  .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dbUrl}`)
  .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${randomBytes(32).toString('hex')}`)
  .replace(/^DATA_ENCRYPTION_KEY=.*$/m, `DATA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
writeFileSync(target, env);
console.log(`✓ Created ${target} (DATABASE_URL=${dbUrl.replace(/:[^:@/]+@/, ':****@')})`);
