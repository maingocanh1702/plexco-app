import { asc, eq } from "drizzle-orm";
import { sports } from "../schema.js";
import type { Db } from "./client.js";

/**
 * Active sports for the session form's sport picker. `sports` is a GLOBAL directory (no tenant
 * column, no RLS; `app` holds SELECT per migration 0009), so this runs without `withTenant`.
 * Only the three columns the picker needs leave; inactive sports never do (SPORT_INACTIVE is the
 * command's own backstop for a stale client).
 */
export interface ActiveSport {
  id: string;
  key: string;
  name: string;
}

export async function listActiveSports(db: Db): Promise<ActiveSport[]> {
  return db
    .select({ id: sports.id, key: sports.key, name: sports.name })
    .from(sports)
    .where(eq(sports.active, true))
    .orderBy(asc(sports.name), asc(sports.id));
}
