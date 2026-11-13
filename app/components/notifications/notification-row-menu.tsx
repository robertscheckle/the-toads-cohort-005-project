import { useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  EllipsisVertical,
  Mail,
  MailOpen,
} from "lucide-react";
import {
  useNotifications,
  type NotificationItem,
} from "./notifications-provider";
import {
  isMandatoryNotificationType,
  MANDATORY_MUTE_MESSAGE,
  NOTIFICATION_TYPE_LABELS,
  type NotificationType,
} from "~/lib/notifications";

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/**
 * Mutes a type through the same action as the settings page's switch, then
 * toasts a pointer to Settings → Notifications. Lives in the always-mounted
 * menu root: the menu's content unmounts as soon as an item is selected.
 */
function useMuteNotificationType(type: NotificationType | null) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !type) return;
    if (fetcher.data.ok) {
      toast.success(`${NOTIFICATION_TYPE_LABELS[type]} Notifications muted.`, {
        description: "Turn them back on in Settings → Notifications.",
        action: {
          label: "Settings",
          onClick: () => navigate("/settings#notifications"),
        },
      });
    } else if (fetcher.data.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, type, navigate]);

  return (mutedType: NotificationType) =>
    fetcher.submit(
      { type: mutedType, enabled: "false" },
      { method: "post", action: "/api/notification-preferences" }
    );
}

/**
 * "Mute {Type} Notifications": writes the same setting as the settings page's
 * switch, then points to Settings → Notifications. Disabled for Mandatory
 * types, which can't be muted.
 */
function MuteTypeItem({
  type,
  onMute,
}: {
  type: NotificationType;
  onMute: (type: NotificationType) => void;
}) {
  if (isMandatoryNotificationType(type)) {
    return (
      <DropdownMenu.Item className={ITEM_CLASS} disabled>
        <BellOff className="size-4" /> {MANDATORY_MUTE_MESSAGE}
      </DropdownMenu.Item>
    );
  }

  return (
    <DropdownMenu.Item className={ITEM_CLASS} onSelect={() => onMute(type)}>
      <BellOff className="size-4" /> Mute {NOTIFICATION_TYPE_LABELS[type]}{" "}
      Notifications
    </DropdownMenu.Item>
  );
}

/** The row's ⋮ menu: mark read / unread, archive / move back, mute type. */
export function NotificationRowMenu({ item }: { item: NotificationItem }) {
  const { markRead, markUnread, archive, unarchive } = useNotifications();
  const mute = useMuteNotificationType(item.type);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title="More actions"
          aria-label="More actions"
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <EllipsisVertical className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {item.read ? (
            <DropdownMenu.Item
              className={ITEM_CLASS}
              onSelect={() => void markUnread(item)}
            >
              <Mail className="size-4" /> Mark as unread
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              className={ITEM_CLASS}
              onSelect={() => void markRead(item)}
            >
              <MailOpen className="size-4" /> Mark as read
            </DropdownMenu.Item>
          )}
          {item.archived ? (
            <DropdownMenu.Item
              className={ITEM_CLASS}
              onSelect={() => void unarchive(item)}
            >
              <ArchiveRestore className="size-4" /> Move back to list
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              className={ITEM_CLASS}
              onSelect={() => void archive(item)}
            >
              <Archive className="size-4" /> Archive
            </DropdownMenu.Item>
          )}
          {item.type && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <MuteTypeItem type={item.type} onMute={mute} />
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
