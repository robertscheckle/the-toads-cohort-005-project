// PROTOTYPE — throwaway. Wayfinder ticket "Prototype how Notifications look
// and where they sit" (#11). Three variants of where Notifications sit in the
// app layout, switchable via `?variant=A|B|C`. Mock data per role, in memory
// only; no Knock, no database. Never merge to main.
//
// Notifications are built per user from the real seed data
// (app/lib/notifications-prototype.server.ts); actions stay in memory.
//
//   A  Bell in the sidebar header → dropdown feed → "View all" /notifications
//   B  "Notifications" sidebar nav item with a count → /notifications only
//   C  Floating bell top-right of the page → right-hand drawer, "Needs you" pinned

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router";
import { Dialog, DropdownMenu, Popover } from "radix-ui";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  Bell,
  BellOff,
  CheckCheck,
  CircleCheck,
  CircleX,
  EllipsisVertical,
  Inbox,
  Mail,
  MailOpen,
  MessageSquare,
  MessageSquareReply,
  ReceiptText,
  Settings,
  ShoppingCart,
  Star,
  Undo2,
  UserCheck,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

// ─── Model ──────────────────────────────────────────────────────────────────

export type NotificationType =
  | "Refund Requested"
  | "Refund Approved"
  | "Refund Declined"
  | "Refunded"
  | "Comment Replied"
  | "Comment Posted"
  | "Course Purchased"
  | "Purchase Refunded"
  | "Course Rated"
  | "Team Seat Claimed";

const MANDATORY: NotificationType[] = [
  "Refund Requested",
  "Refund Approved",
  "Refund Declined",
  "Refunded",
];

export interface ProtoNotification {
  id: string;
  type: NotificationType;
  actors: string[]; // >1 means a Grouped Notification
  course: string;
  lesson?: string;
  extra?: string;
  href: string;
  minutesAgo: number;
  read: boolean;
  archived: boolean;
}

const TYPE_META: Record<
  NotificationType,
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  "Refund Requested": { icon: ReceiptText, tone: "text-amber-600" },
  "Refund Approved": { icon: CircleCheck, tone: "text-emerald-600" },
  "Refund Declined": { icon: CircleX, tone: "text-red-600" },
  Refunded: { icon: Banknote, tone: "text-emerald-600" },
  "Comment Replied": { icon: MessageSquareReply, tone: "text-sky-600" },
  "Comment Posted": { icon: MessageSquare, tone: "text-sky-600" },
  "Course Purchased": { icon: ShoppingCart, tone: "text-violet-600" },
  "Purchase Refunded": { icon: Undo2, tone: "text-orange-600" },
  "Course Rated": { icon: Star, tone: "text-yellow-500" },
  "Team Seat Claimed": { icon: UserCheck, tone: "text-violet-600" },
};

function actorsText(actors: string[]) {
  if (actors.length === 1) return actors[0];
  if (actors.length === 2) return `${actors[0]} and ${actors[1]}`;
  return `${actors[0]} and ${actors.length - 1} others`;
}

function NotificationText({ n }: { n: ProtoNotification }) {
  const who = <strong className="font-medium">{actorsText(n.actors)}</strong>;
  const course = <strong className="font-medium">{n.course}</strong>;
  const lesson = <strong className="font-medium">{n.lesson}</strong>;
  switch (n.type) {
    case "Refund Requested":
      return (
        <>
          {who} requested a refund for {course}
        </>
      );
    case "Refund Approved":
      return <>Your refund for {course} was approved. Payment is on its way.</>;
    case "Refund Declined":
      return <>Your refund request for {course} was declined.</>;
    case "Refunded":
      return (
        <>
          {n.extra} was refunded for {course}. Your access has ended.
        </>
      );
    case "Comment Replied":
      return (
        <>
          {who} replied to your comment on {lesson}
        </>
      );
    case "Comment Posted":
      return (
        <>
          {who} commented on {lesson}
        </>
      );
    case "Course Purchased":
      return (
        <>
          {who} bought {course}
          {n.extra ? ` (${n.extra})` : ""}
        </>
      );
    case "Purchase Refunded":
      return (
        <>
          {who}'s purchase of {course} was refunded
        </>
      );
    case "Course Rated":
      return (
        <>
          {who} rated {course}
          {n.extra ? ` ${n.extra}` : ""}
        </>
      );
    case "Team Seat Claimed":
      return (
        <>
          {who} claimed {n.actors.length === 1 ? "a Team Seat" : "Team Seats"}{" "}
          for {course}
        </>
      );
  }
}

function timeAgo(minutes: number) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

// ─── In-memory store ────────────────────────────────────────────────────────

function useNotificationStore(
  userId: number | null,
  initial: ProtoNotification[]
) {
  const [items, setItems] = useState(initial);
  const [muted, setMuted] = useState<NotificationType[]>([]);
  const [lastUser, setLastUser] = useState(userId);
  if (userId !== lastUser) {
    setLastUser(userId);
    setItems(initial);
    setMuted([]);
  }
  const patch = (id: string, p: Partial<ProtoNotification>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return {
    items,
    muted,
    unread: items.filter((x) => !x.read && !x.archived).length,
    markRead: (id: string) => patch(id, { read: true }),
    markUnread: (id: string) => patch(id, { read: false }),
    archive: (id: string) => patch(id, { archived: true, read: true }),
    unarchive: (id: string) => patch(id, { archived: false }),
    markAllRead: () => setItems((xs) => xs.map((x) => ({ ...x, read: true }))),
    mute: (t: NotificationType) => {
      setMuted((m) => [...m, t]);
      toast(`Muted ${t} Notifications`, {
        description: "Change this in Settings → Notifications.",
      });
    },
    clear: () => setItems([]),
    reset: () => setItems(initial),
    // Simulates a live arrival: a fresh copy of this person's newest
    // non-Refund Notification, from a made-up actor.
    pushNew: () => {
      const source = items.find((x) => !MANDATORY.includes(x.type)) ?? items[0];
      if (!source) {
        toast("(Nothing in this person's history to simulate from)");
        return;
      }
      const n: ProtoNotification = {
        ...source,
        id: `new-${Date.now()}`,
        actors: ["Simulated Person"],
        minutesAgo: 0,
        read: false,
        archived: false,
      };
      if (muted.includes(n.type)) {
        toast(`(${n.type} is muted, so nothing arrives)`);
        return;
      }
      setItems((xs) => [n, ...xs]);
      return n;
    },
  };
}

type Store = ReturnType<typeof useNotificationStore>;
const StoreContext = createContext<Store | null>(null);
const useStore = () => useContext(StoreContext)!;

// ─── Shared pieces ──────────────────────────────────────────────────────────

function UnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function RowMenu({ n }: { n: ProtoNotification }) {
  const s = useStore();
  const mandatory = MANDATORY.includes(n.type);
  const item =
    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 data-[state=open]:opacity-100"
          title="More"
        >
          <EllipsisVertical className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-[60] min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          {n.read ? (
            <DropdownMenu.Item
              className={item}
              onSelect={() => s.markUnread(n.id)}
            >
              <Mail className="size-4" /> Mark as unread
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              className={item}
              onSelect={() => s.markRead(n.id)}
            >
              <MailOpen className="size-4" /> Mark as read
            </DropdownMenu.Item>
          )}
          {n.archived ? (
            <DropdownMenu.Item
              className={item}
              onSelect={() => s.unarchive(n.id)}
            >
              <ArchiveRestore className="size-4" /> Move back to list
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              className={item}
              onSelect={() => s.archive(n.id)}
            >
              <Archive className="size-4" /> Archive
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={item}
            disabled={mandatory || s.muted.includes(n.type)}
            onSelect={() => s.mute(n.type)}
          >
            <BellOff className="size-4" />
            {mandatory
              ? "Refund Notifications can't be muted"
              : `Mute ${n.type} Notifications`}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Row({
  n,
  dense,
  onOpen,
}: {
  n: ProtoNotification;
  dense?: boolean;
  onOpen?: () => void;
}) {
  const s = useStore();
  const { icon: Icon, tone } = TYPE_META[n.type];
  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 border-b transition-colors last:border-b-0 hover:bg-accent/60",
        dense ? "px-3 py-2.5" : "px-4 py-3.5",
        !n.read && "bg-sky-50/70 dark:bg-sky-950/30"
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex shrink-0 items-center justify-center rounded-full bg-muted",
          dense ? "size-7" : "size-9"
        )}
      >
        <Icon className={cn(dense ? "size-3.5" : "size-4", tone)} />
      </div>
      <Link
        to={n.href}
        onClick={() => {
          s.markRead(n.id);
          onOpen?.();
        }}
        className="min-w-0 flex-1"
      >
        <p className={cn("text-sm", n.read && "text-muted-foreground")}>
          <NotificationText n={n} />
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {n.type}
          {n.actors.length > 1 && ` · ${n.actors.length} events`} ·{" "}
          {timeAgo(n.minutesAgo)}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {!n.read && <span className="size-2 rounded-full bg-sky-600" />}
        {!n.archived && (
          <button
            onClick={() => s.archive(n.id)}
            className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
            title="Archive"
          >
            <Archive className="size-4" />
          </button>
        )}
        <RowMenu n={n} />
      </div>
    </div>
  );
}

function EmptyState({ archived }: { archived?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground/60" />
      <p className="text-sm font-medium">
        {archived ? "Nothing archived" : "You're all caught up"}
      </p>
      <p className="text-xs text-muted-foreground">
        {archived
          ? "Archived Notifications show up here."
          : "Notifications about your Courses and Purchases will show up here."}
      </p>
    </div>
  );
}

type Filter = "unread" | "all" | "archived";

function FilterTabs({
  value,
  onChange,
  showArchived,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
  showArchived?: boolean;
}) {
  const s = useStore();
  const opts: Filter[] = showArchived
    ? ["all", "unread", "archived"]
    : ["all", "unread"];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
            value === o
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          {o}
          {o === "unread" && s.unread > 0 && ` (${s.unread})`}
        </button>
      ))}
    </div>
  );
}

function filtered(items: ProtoNotification[], f: Filter) {
  if (f === "archived") return items.filter((x) => x.archived);
  if (f === "unread") return items.filter((x) => !x.read && !x.archived);
  return items.filter((x) => !x.archived);
}

// ─── Full page at /notifications (A's "View all", and B) ────────────────────────────

export function NotificationsPage() {
  const s = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const list = filtered(s.items, filter);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            What's happened in your Courses and Purchases. Kept for 90 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={s.markAllRead}
            disabled={s.unread === 0}
          >
            <CheckCheck /> Mark all read
          </Button>
          <Button variant="ghost" size="icon-sm" asChild title="Settings">
            <Link to="/settings">
              <Settings />
            </Link>
          </Button>
        </div>
      </div>
      <div className="mb-3">
        <FilterTabs value={filter} onChange={setFilter} showArchived />
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {list.length === 0 ? (
          <EmptyState archived={filter === "archived"} />
        ) : (
          list.map((n) => <Row key={n.id} n={n} />)
        )}
      </div>
    </div>
  );
}

// ─── Variant A: bell in sidebar header → dropdown → full page ───────────────

function VariantABell() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const navigate = useNavigate();
  const list = filtered(s.items, filter).slice(0, 8);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          title="Notifications"
        >
          <Bell className="size-4" />
          <UnreadBadge count={s.unread} className="absolute -right-1 -top-1" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={s.markAllRead}
              disabled={s.unread === 0}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          </div>
          <div className="border-b px-3 py-2">
            <FilterTabs value={filter} onChange={setFilter} />
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {list.length === 0 ? (
              <EmptyState />
            ) : (
              list.map((n) => (
                <Row key={n.id} n={n} dense onOpen={() => setOpen(false)} />
              ))
            )}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
            className="block w-full border-t px-3 py-2 text-center text-sm font-medium text-primary hover:bg-accent"
          >
            View all Notifications
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Variant B: sidebar nav item → full page only ───────────────────────────

function VariantBNavItem() {
  const s = useStore();
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) =>
        cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Bell className="size-4" />
      Notifications
      <UnreadBadge count={s.unread} className="ml-auto" />
    </NavLink>
  );
}

// ─── Variant C: floating bell top-right → right drawer ──────────────────────

function VariantCDrawer() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const active = s.items.filter((x) => !x.archived);
  const needsYou = active.filter(
    (x) => x.type === "Refund Requested" && !x.read
  );
  const rest = active.filter((x) => !needsYou.includes(x));
  const today = rest.filter((x) => x.minutesAgo < 60 * 24);
  const earlier = rest.filter((x) => x.minutesAgo >= 60 * 24);
  const archived = s.items.filter((x) => x.archived);

  const section = (title: string, xs: ProtoNotification[]) =>
    xs.length > 0 && (
      <div>
        <div className="sticky top-0 z-10 bg-background/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
          {title}
        </div>
        {xs.map((n) => (
          <Row key={n.id} n={n} onOpen={() => setOpen(false)} />
        ))}
      </div>
    );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className={cn(
            "fixed right-6 top-4 z-40 flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm shadow-sm hover:bg-accent",
            s.unread > 0 && "border-sky-300 dark:border-sky-800"
          )}
        >
          <Bell className="size-4" />
          {s.unread > 0 ? `${s.unread} new` : "Notifications"}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[440px] flex-col border-l bg-background shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="text-base font-semibold">
              Notifications
            </Dialog.Title>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={s.markAllRead}
                disabled={s.unread === 0}
              >
                <CheckCheck /> Mark all read
              </Button>
              <Button variant="ghost" size="icon-sm" asChild title="Settings">
                <Link to="/settings" onClick={() => setOpen(false)}>
                  <Settings />
                </Link>
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon-sm">
                  <X />
                </Button>
              </Dialog.Close>
            </div>
          </div>
          <Dialog.Description className="sr-only">
            Your Notifications
          </Dialog.Description>
          <div className="flex-1 overflow-y-auto">
            {showArchived ? (
              archived.length === 0 ? (
                <EmptyState archived />
              ) : (
                archived.map((n) => <Row key={n.id} n={n} />)
              )
            ) : active.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {needsYou.length > 0 && (
                  <div className="border-b-4 border-amber-200 dark:border-amber-900">
                    {section("Needs you", needsYou)}
                  </div>
                )}
                {section("Today", today)}
                {section("Earlier", earlier)}
              </>
            )}
          </div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center justify-center gap-2 border-t px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent"
          >
            <Archive className="size-4" />
            {showArchived ? "Back to Notifications" : "Archived"}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Wiring ─────────────────────────────────────────────────────────────────

export const PROTOTYPE_VARIANTS = [
  { key: "A", name: "Bell + dropdown + page" },
  { key: "B", name: "Sidebar item + page" },
  { key: "C", name: "Floating bell + drawer" },
];

export function NotificationsPrototypeProvider({
  userId,
  initial,
  children,
}: {
  userId: number | null;
  initial: ProtoNotification[];
  children: React.ReactNode;
}) {
  const store = useNotificationStore(userId, initial);
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

const VARIANT_KEY = "notifications-prototype-variant";

export function useNotificationsPrototype() {
  const [params] = useSearchParams();
  const fromUrl = params.get("variant");
  // Links drop ?variant=, so remember the last one instead of rewriting the
  // URL (rewriting it would lose a #comment-<id> hash).
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (fromUrl) localStorage.setItem(VARIANT_KEY, fromUrl);
      setSaved(fromUrl ?? localStorage.getItem(VARIANT_KEY));
    } catch {}
  }, [fromUrl]);
  const variant = fromUrl ?? saved ?? "A";
  return useMemo(
    () => ({
      variant,
      sidebarHeaderSlot: variant === "A" ? <VariantABell /> : null,
      sidebarNavSlot: variant === "B" ? <VariantBNavItem /> : null,
      overlay: variant === "C" ? <VariantCDrawer /> : null,
    }),
    [variant]
  );
}

export function PrototypeControls() {
  const s = useStore();
  const btn =
    "rounded-full px-2 py-0.5 text-xs text-white/80 hover:bg-white/15 hover:text-white";
  return (
    <>
      <button
        className={btn}
        onClick={() => {
          const n = s.pushNew();
          if (n)
            toast(n.type, {
              description: "Toast on live arrival: keep or drop?",
              icon: <Bell className="size-4" />,
            });
        }}
      >
        + new
      </button>
      <button className={btn} onClick={s.clear}>
        empty
      </button>
      <button className={btn} onClick={s.reset}>
        reset
      </button>
    </>
  );
}
