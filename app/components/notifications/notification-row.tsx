import { Link } from "react-router";
import { Archive } from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import { NOTIFICATION_TYPE_LABELS } from "~/lib/notifications";
import {
  useNotifications,
  type NotificationItem,
} from "./notifications-provider";
import { NotificationRowMenu } from "./notification-row-menu";
import { rowDefinitionFor } from "./registry";

/**
 * One Notification: type icon, sentence, meta line, and (on hover) Archive
 * and the ⋮ menu. Clicking the sentence marks it read and opens it. What a
 * type looks like comes from its row definition in ./registry.ts.
 */
export function NotificationRow({ item }: { item: NotificationItem }) {
  const { markRead, archive } = useNotifications();
  const { icon: Icon, tone, Sentence, href } = rowDefinitionFor(item.type);
  const unread = !item.read;
  const meta = [
    item.type ? NOTIFICATION_TYPE_LABELS[item.type] : "Notification",
    item.totalActivities > 1 ? `${item.totalActivities} events` : null,
    formatRelativeTime(item.insertedAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-accent/60",
        unread && "bg-sky-50/70 dark:bg-sky-950/30"
      )}
    >
      {unread && <span className="absolute inset-y-0 left-0 w-1 bg-sky-600" />}
      <span
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
          unread
            ? "bg-sky-100 dark:bg-sky-900"
            : "bg-muted opacity-50 grayscale"
        )}
      >
        <Icon className={cn("size-4", tone)} />
      </span>
      <Link
        to={href(item)}
        onClick={() => {
          if (unread) void markRead(item);
        }}
        className="min-w-0 flex-1"
      >
        <span
          className={cn(
            "block text-sm",
            unread
              ? "text-foreground [&_strong]:font-semibold"
              : "text-muted-foreground [&_strong]:font-normal"
          )}
        >
          <Sentence item={item} />
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {unread && (
            <span className="font-semibold text-sky-700 dark:text-sky-400">
              New ·{" "}
            </span>
          )}
          {meta}
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {unread && <span className="size-2 rounded-full bg-sky-600" />}
        {!item.archived && (
          <button
            type="button"
            onClick={() => void archive(item)}
            title="Archive"
            aria-label="Archive"
            className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Archive className="size-4" />
          </button>
        )}
        <NotificationRowMenu item={item} />
      </div>
    </div>
  );
}
