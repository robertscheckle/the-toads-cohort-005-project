import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Bell, CheckCheck, Inbox, Settings } from "lucide-react";
import type { Route } from "./+types/notifications";
import { requireUserId } from "~/lib/access.server";
import {
  holdArrivals,
  newNotificationsLabel,
  notificationsForTab,
  type NotificationTab,
} from "~/lib/notification-feed";
import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useNotifications } from "~/components/notifications/notifications-provider";
import { NotificationRow } from "~/components/notifications/notification-row";
import { useHeldArrivals } from "~/components/notifications/use-held-arrivals";

export function meta() {
  return [{ title: "Notifications — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  return null;
}

function isTab(value: string): value is NotificationTab {
  return value === "all" || value === "unread" || value === "archived";
}

export default function NotificationsPage() {
  const { items, unreadCount, loading, refetch, markAllRead, feedClient } =
    useNotifications();
  const [tab, setTab] = useState<NotificationTab>("all");
  const { heldIds, showHeld } = useHeldArrivals(feedClient);

  // Knock doesn't push read-state changes: fetch fresh state on open.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const { shown, heldCount } = holdArrivals(items, heldIds);
  const list = notificationsForTab(shown, tab);

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-1 text-muted-foreground">
            What's happened in your Courses and Purchases.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
          >
            <CheckCheck /> Mark all read
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/settings#notifications" title="Notification settings">
              <Settings />
            </Link>
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isTab(value)) setTab(value);
        }}
        className="mb-3"
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread{unreadCount > 0 && ` (${unreadCount})`}
          </TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
      </Tabs>

      {heldCount > 0 && (
        <button
          type="button"
          onClick={showHeld}
          className="sticky top-3 z-20 mx-auto mb-2 flex items-center gap-2 rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white shadow"
        >
          <Bell className="size-3.5" />
          {newNotificationsLabel(heldCount)} · Show
        </button>
      )}

      {list.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          {list.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </div>
      ) : loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading Notifications…
        </p>
      ) : (
        <EmptyState archived={tab === "archived"} />
      )}
    </div>
  );
}

function EmptyState({ archived }: { archived: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-6 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" />
      <p className="font-medium">
        {archived ? "Nothing archived" : "You're all caught up"}
      </p>
      <p className="text-sm text-muted-foreground">
        {archived
          ? "Archived Notifications show up here."
          : "Notifications about your Courses and Purchases show up here."}
      </p>
    </div>
  );
}
