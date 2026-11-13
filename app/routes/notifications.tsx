import { useEffect } from "react";
import { Link } from "react-router";
import { Inbox, Settings } from "lucide-react";
import type { Route } from "./+types/notifications";
import { requireUserId } from "~/lib/access.server";
import { Button } from "~/components/ui/button";
import { useNotifications } from "~/components/notifications/notifications-provider";
import { NotificationRow } from "~/components/notifications/notification-row";

export function meta() {
  return [{ title: "Notifications — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  return null;
}

export default function NotificationsPage() {
  const { items, loading, refetch } = useNotifications();

  // Knock doesn't push read-state changes: fetch fresh state on open.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const list = items.filter((item) => !item.archived);

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-1 text-muted-foreground">
            What's happened in your Courses and Purchases.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/settings#notifications" title="Notification settings">
            <Settings />
          </Link>
        </Button>
      </div>

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
        <div className="flex flex-col items-center gap-2 rounded-lg border bg-card py-12 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <p className="font-medium">You're all caught up</p>
        </div>
      )}
    </div>
  );
}
