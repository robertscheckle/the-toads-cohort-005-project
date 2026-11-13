// Pure rules behind the Notifications page: which Notifications each tab
// shows, which new arrivals wait behind the pill, and how archiving works.
// Kept free of Knock and React so they can be tested on their own.

export type NotificationTab = "all" | "unread" | "archived";

type FeedEntry = { id: string; read: boolean; archived: boolean };

/** All: not archived. Unread: unread and not archived. Archived: archived. */
export function notificationsForTab<T extends FeedEntry>(
  items: T[],
  tab: NotificationTab
): T[] {
  if (tab === "archived") return items.filter((item) => item.archived);
  if (tab === "unread")
    return items.filter((item) => !item.read && !item.archived);
  return items.filter((item) => !item.archived);
}

/**
 * Notifications that arrived while the page was open (`heldIds`) wait behind
 * the "n new Notifications · Show" pill, so rows never move under the reader.
 */
export function holdArrivals<T extends FeedEntry>(
  items: T[],
  heldIds: readonly string[]
): { shown: T[]; heldCount: number } {
  const held = new Set(heldIds);
  const shown = items.filter((item) => !held.has(item.id));
  return { shown, heldCount: items.length - shown.length };
}

/** The pill's text: "1 new Notification" / "3 new Notifications". */
export function newNotificationsLabel(count: number): string {
  return `${count} new ${count === 1 ? "Notification" : "Notifications"}`;
}

/**
 * Archive is two calls, since Knock has no single one: mark archived, then mark
 * read, so an archived Notification never counts as unread.
 */
export async function archiveNotification<T>(
  feed: {
    markAsArchived: (item: T) => Promise<unknown>;
    markAsRead: (item: T) => Promise<unknown>;
  },
  item: { read: boolean; feedItem: T }
): Promise<void> {
  await feed.markAsArchived(item.feedItem);
  if (!item.read) await feed.markAsRead(item.feedItem);
}
