import path from 'node:path';
import pg from 'pg';
import { MediaRuntime } from '@mediaruntime/node';
export function config() {
  for (const key of ['DATABASE_URL','MEDIARUNTIME_API_KEY','MEDIARUNTIME_WEBHOOK_SECRET','MEDIARUNTIME_ACCOUNT_ID'])
    if (!process.env[key]?.trim()) throw new Error(`Set ${key} in your private .env file.`);
  return { pool: new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6, connectionTimeoutMillis: 5000 }),
    media: new MediaRuntime(), accountId: process.env.MEDIARUNTIME_ACCOUNT_ID,
    root: path.resolve(process.env.MEDIA_ROOT || './var/media'),
    port: Number(process.env.PORT || 3000), webhookPort: Number(process.env.WEBHOOK_PORT || 3001) };
}
