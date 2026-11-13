import { DropdownMenu } from "radix-ui";
import {
  Archive,
  ArchiveRestore,
  EllipsisVertical,
  Mail,
  MailOpen,
} from "lucide-react";
import {
  useNotifications,
  type NotificationItem,
} from "./notifications-provider";

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/** The row's ⋮ menu: mark read / unread, archive / move back. */
export function NotificationRowMenu({ item }: { item: NotificationItem }) {
  const { markRead, markUnread, archive, unarchive } = useNotifications();

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
          {/*
            #32 adds per-type actions here: a <DropdownMenu.Separator
            className="my-1 h-px bg-border" /> then a "Mute {Type}
            Notifications" item (disabled for mandatory types, see
            isMandatoryNotificationType in ~/lib/notifications). Use
            ITEM_CLASS for the item.
          */}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
