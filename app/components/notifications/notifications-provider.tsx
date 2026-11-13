import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Feed, FeedItem } from "@knocklabs/client";
import {
  KnockFeedProvider,
  KnockProvider,
  useKnockFeed,
} from "@knocklabs/react";
import {
  isNotificationType,
  type KnockFeedConfig,
  type NotificationType,
} from "~/lib/notifications";

// ─── Notifications store ───
// Knock's React hooks (no prebuilt components) behind one small store that the
// sidebar item and the Notifications page read with useNotifications().
//
// Without Knock keys (or before the client mounts, or signed out) the store is
// EMPTY_STORE: an empty feed, no count, no-op actions.

/** A feed item in Cadence's terms. `data` is the trigger data. */
export type NotificationItem = {
  id: string;
  /** The workflow key, or null for a type this build doesn't know. */
  type: NotificationType | null;
  /** Actor names, as passed inline when the Notification was triggered. */
  actors: string[];
  totalActors: number;
  /** More than 1 means a Grouped Notification. */
  totalActivities: number;
  data: Record<string, unknown>;
  insertedAt: string;
  read: boolean;
  archived: boolean;
  feedItem: FeedItem;
};

export type NotificationsStore = {
  items: NotificationItem[];
  /** Knock's own unread count (what the sidebar shows). */
  unreadCount: number;
  /** True until the first fetch has finished. */
  loading: boolean;
  refetch: () => Promise<void>;
  markRead: (item: NotificationItem) => Promise<void>;
  /** Knock's feed client, for actions the store doesn't wrap yet. */
  feedClient: Feed | null;
};

function toNotificationItem(item: FeedItem): NotificationItem {
  const actors = item.actors.map((actor) =>
    "name" in actor && typeof actor.name === "string" && actor.name
      ? actor.name
      : actor.id
  );
  return {
    id: item.id,
    type: isNotificationType(item.source.key) ? item.source.key : null,
    actors,
    totalActors: item.total_actors,
    totalActivities: item.total_activities ?? 1,
    data: item.data ?? {},
    insertedAt: item.inserted_at,
    read: item.read_at !== null,
    archived: item.archived_at !== null,
    feedItem: item,
  };
}

async function logFailure(label: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    console.error(`[notifications] ${label} failed:`, error);
  }
}

const EMPTY_STORE: NotificationsStore = {
  items: [],
  unreadCount: 0,
  loading: false,
  refetch: async () => {},
  markRead: async () => {},
  feedClient: null,
};

/** Knock is configured but its client hasn't mounted yet (server render, first paint). */
const CONNECTING_STORE: NotificationsStore = { ...EMPTY_STORE, loading: true };

const StoreContext = createContext<NotificationsStore>(EMPTY_STORE);

export function useNotifications(): NotificationsStore {
  return useContext(StoreContext);
}

function KnockStore({ children }: { children: React.ReactNode }) {
  const { feedClient, useFeedStore } = useKnockFeed();
  const items = useFeedStore((state) => state.items);
  const unreadCount = useFeedStore((state) => state.metadata.unread_count);

  // Knock's store reports loading=false before its first fetch has started,
  // which would flash the empty state. Track the first fetch ourselves.
  const [fetched, setFetched] = useState(false);
  useEffect(() => {
    setFetched(false);
    feedClient.fetch().finally(() => setFetched(true));
  }, [feedClient]);

  // Stable per feed client, so pages can use them as effect dependencies.
  const refetch = useCallback(
    () => logFailure("refetch", () => feedClient.fetch()),
    [feedClient]
  );
  const markRead = useCallback(
    (item: NotificationItem) =>
      logFailure("mark read", () => feedClient.markAsRead(item.feedItem)),
    [feedClient]
  );

  const store = useMemo<NotificationsStore>(
    () => ({
      items: items.map(toNotificationItem),
      unreadCount,
      loading: !fetched,
      refetch,
      markRead,
      feedClient,
    }),
    [items, unreadCount, fetched, refetch, markRead, feedClient]
  );

  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

export function NotificationsProvider({
  knock,
  children,
}: {
  knock: KnockFeedConfig | null;
  children: React.ReactNode;
}) {
  // Knock's client is browser-only (it opens a socket): mount it after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!knock || !mounted) {
    return (
      <StoreContext.Provider value={knock ? CONNECTING_STORE : EMPTY_STORE}>
        {children}
      </StoreContext.Provider>
    );
  }

  return (
    <KnockProvider
      key={knock.userId}
      apiKey={knock.publicKey}
      user={{ id: knock.userId }}
      userToken={knock.userToken}
    >
      <KnockFeedProvider
        feedId={knock.feedChannelId}
        defaultFeedOptions={{
          mode: "rich",
          archived: "include",
          page_size: 50,
        }}
      >
        <KnockStore>{children}</KnockStore>
      </KnockFeedProvider>
    </KnockProvider>
  );
}
