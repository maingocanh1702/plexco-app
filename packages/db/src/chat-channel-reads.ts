import { sql } from "drizzle-orm";
import { ChatCommandError, type ChatTx } from "./chat-service.js";

// RO-L15-2: the allowlisted channel columns plus the capped unread count; never a cursor, creator or assistant column.
export type ChatChannelRow = {
  id: string;
  title: string;
  sortOrder: number;
  isDefault: boolean;
  postPolicy: "all_members" | "admins_only";
  unreadCount: number;
};

/** The bound actor's (app.person_id) club, non-archived channels under RLS (chat_current_is_member, 0031:280-292:
 *  only a chat_members row whose membership is active); unread = rows after the actor's own (created_at, id) cursor
 *  (NULL = all), not the actor's, tombstones included, capped at 100. Zero rows: D-23. */
export async function listChatChannels(tx: ChatTx): Promise<ChatChannelRow[]> {
  const { rows } = await tx.execute(sql`
    SELECT c.id, c.title, c.sort_order AS "sortOrder", c.is_default AS "isDefault", c.post_policy AS "postPolicy",
      (SELECT count(*)::int FROM (
         SELECT 1 FROM chat_messages m
          WHERE m.channel_id = c.id AND m.author_person_id IS DISTINCT FROM cm.person_id
            -- ONE row comparison, so it is an index range on (channel_id, created_at, id) (0031:146); a NULL cursor
            -- is (-infinity, nil uuid) = from the start, and 0031:118 keeps both cursor halves NULL together.
            AND (m.created_at, m.id) > (COALESCE(cm.last_read_created_at, '-infinity'::timestamptz),
              COALESCE(cm.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid))
          LIMIT 100) capped) AS "unreadCount"
      FROM chat_channels c
      JOIN chat_members cm
        ON cm.channel_id = c.id AND cm.person_id = NULLIF(current_setting('app.person_id', true), '')::uuid
     WHERE c.kind = 'club' AND c.archived_at IS NULL
       AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     ORDER BY c.sort_order, c.id`);
  if (rows.length === 0) throw new ChatCommandError("CHAT_FORBIDDEN");
  return rows as ChatChannelRow[];
}
