import { db } from './server/db.js';
import { responses } from './shared/schema.js';
import { eq, desc } from 'drizzle-orm';

async function check() {
  const res = await db.select().from(responses).orderBy(desc(responses.createdAt)).limit(3);
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
check();
