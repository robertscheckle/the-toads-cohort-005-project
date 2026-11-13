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

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FeedItem } from "@knocklabs/client";
import {
  KnockFeedProvider,
  KnockProvider,
  useKnockFeed,
} from "@knocklabs/react";
import {
  Link,
  NavLink,
  useFetcher,
  useNavigate,
  useSearchParams,
} from "react-router";
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
  actors: string[]; // names Knock returns (rich mode)
  totalActors: number; // Knock's total_actors
  events: number; // Knock's total_activities; >1 means a Grouped Notification
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

function actorsText(actors: string[], total = actors.length) {
  if (total <= 1) return actors[0];
  if (total === 2 && actors.length >= 2) return `${actors[0]} and ${actors[1]}`;
  return `${actors[0]} and ${total - 1} other${total - 1 === 1 ? "" : "s"}`;
}

function NotificationText({ n }: { n: ProtoNotification }) {
  const who = (
    <strong className="font-medium">
      {actorsText(n.actors, n.totalActors)}
    </strong>
  );
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

// ─── Knock-backed store (#24) ───────────────────────────────────────────────
// Replaces the in-memory store. Read, unread and archived live in Knock only
// (#13). Muting stays in memory: preferences aren't part of this prototype.

const SOURCE_TYPE: Record<string, NotificationType> = {
  "comment-replied": "Comment Replied",
  "course-purchased": "Course Purchased",
  "refund-requested": "Refund Requested",
};

export interface KnockFeedConfig {
  publicKey: string;
  feedChannelId: string;
  userId: string;
  userToken: string;
}

// How a Notification that arrives over the WebSocket is shown. Switch it from
// the prototype bar to compare.
export const ARRIVAL_MODES = ["live", "live + toast", "pill", "next load"];
type ArrivalMode = (typeof ARRIVAL_MODES)[number];

function toProto(i: FeedItem): ProtoNotification {
  const d = (i.data ?? {}) as Record<string, string | number | undefined>;
  const names = i.actors.map(
    (a) => ("name" in a && a.name ? String(a.name) : null) ?? a.id
  );
  return {
    id: i.id,
    type: SOURCE_TYPE[i.source.key] ?? "Comment Replied",
    actors: names.length ? names : ["Someone"],
    totalActors: i.total_actors,
    events: i.total_activities ?? 1,
    course: String(d.course_title ?? ""),
    lesson: d.lesson_title ? String(d.lesson_title) : undefined,
    href: String(d.url ?? "/notifications"),
    minutesAgo: Math.max(
      0,
      Math.round((Date.now() - Date.parse(i.inserted_at)) / 60_000)
    ),
    read: !!i.read_at,
    archived: !!i.archived_at,
  };
}

function useNotificationStore() {
  const { feedClient, useFeedStore } = useKnockFeed();
  const navigate = useNavigate();
  const raw = useFeedStore((st) => st.items);
  const meta = useFeedStore((st) => st.metadata);
  const loading = useFeedStore((st) => st.loading);
  const [muted, setMuted] = useState<NotificationType[]>([]);
  const [mode, setMode] = useState<ArrivalMode>("live");
  const [held, setHeld] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const note = (m: string) =>
    setLog((l) =>
      [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 8)
    );

  // Knock's store says loading=false before the first fetch starts, which
  // flashes "You're all caught up"; track the first fetch ourselves.
  const [fetched, setFetched] = useState(false);
  useEffect(() => {
    feedClient.fetch().finally(() => setFetched(true));
  }, [feedClient]);

  // Realtime: Knock's socket says "new message" with no content; the client
  // then fetches the new items and emits them here.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const onRealtime = ({ items }: { items: FeedItem[] }) => {
      note(`socket → ${items.length} new item(s)`);
      const m = modeRef.current;
      if (m === "pill" || m === "next load")
        setHeld((h) => [...h, ...items.map((i) => i.id)]);
      if (m === "live + toast")
        for (const i of items) {
          const n = toProto(i);
          toast(n.type, {
            description: `${actorsText(n.actors, n.totalActors)} · ${n.course}`,
            icon: <Bell className="size-4" />,
            action: { label: "Open", onClick: () => navigate(n.href) },
          });
        }
    };
    feedClient.on("items.received.realtime", onRealtime as never);
    return () => feedClient.off("items.received.realtime", onRealtime as never);
  }, [feedClient]);

  const byId = (id: string) => raw.find((x) => x.id === id);
  const items = raw.filter((x) => !held.includes(x.id)).map(toProto);
  const act = async (label: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      await fn();
      note(`${label} ✓ ${Date.now() - t}ms`);
    } catch (e) {
      note(`${label} ✗ ${(e as Error).message}`);
    }
  };
  const withItem = (
    label: string,
    id: string,
    fn: (i: FeedItem) => Promise<unknown>
  ) => {
    const i = byId(id);
    if (i) act(label, () => fn(i));
  };
  return {
    items,
    muted,
    loading: loading || !fetched,
    knockUnread: meta.unread_count,
    unread: items.filter((x) => !x.read && !x.archived).length,
    mode,
    held: held.length,
    log,
    cycleMode: () => {
      const next =
        ARRIVAL_MODES[(ARRIVAL_MODES.indexOf(mode) + 1) % ARRIVAL_MODES.length];
      setMode(next);
      setHeld([]);
    },
    showHeld: () => setHeld([]),
    refetch: () => act("refetch", () => feedClient.fetch()),
    markRead: (id: string) =>
      withItem("mark read", id, (i) => feedClient.markAsRead(i)),
    markUnread: (id: string) =>
      withItem("mark unread", id, (i) => feedClient.markAsUnread(i)),
    // Archive hides and marks read (#12): two calls, Knock has no single one.
    archive: (id: string) =>
      withItem("archive", id, async (i) => {
        await feedClient.markAsArchived(i);
        if (!i.read_at) await feedClient.markAsRead(i);
      }),
    unarchive: (id: string) =>
      withItem("unarchive", id, (i) => feedClient.markAsUnarchived(i)),
    markAllRead: () => act("mark all read", () => feedClient.markAllAsRead()),
    mute: (t: NotificationType) => {
      setMuted((m) => [...m, t]);
      toast(`Muted ${t} Notifications`, {
        description: "Change this in Settings → Notifications.",
      });
    },
  };
}

type Store = ReturnType<typeof useNotificationStore>;
const StoreContext = createContext<Store | null>(null);
const useStore = () => useContext(StoreContext) ?? EMPTY_STORE;
const noop = () => {};
// Before Knock connects (server render, first paint) or with no user.
const EMPTY_STORE: Store = {
  items: [],
  muted: [],
  loading: true,
  knockUnread: 0,
  unread: 0,
  mode: "live",
  held: 0,
  log: [],
  cycleMode: noop,
  showHeld: noop,
  refetch: async () => {},
  markRead: noop,
  markUnread: noop,
  archive: noop,
  unarchive: noop,
  markAllRead: async () => {},
  mute: noop,
};

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
      {!n.read && <span className="absolute inset-y-0 left-0 w-1 bg-sky-600" />}
      <div
        className={cn(
          "mt-0.5 flex shrink-0 items-center justify-center rounded-full",
          dense ? "size-7" : "size-9",
          n.read
            ? "bg-muted opacity-50 grayscale"
            : "bg-sky-100 dark:bg-sky-900"
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
        <p
          className={cn(
            "text-sm",
            n.read
              ? "text-muted-foreground [&_strong]:font-normal"
              : "text-foreground [&_strong]:font-semibold"
          )}
        >
          <NotificationText n={n} />
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {!n.read && (
            <span className="font-semibold text-sky-700 dark:text-sky-400">
              New ·{" "}
            </span>
          )}
          {n.type}
          {n.events > 1 && ` · ${n.events} events`} · {timeAgo(n.minutesAgo)}
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
  // Knock's socket only announces *new* messages. State changed elsewhere
  // (answering a comment, another tab) shows up only after a fetch.
  useEffect(() => {
    s.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filter, setFilter] = useState<Filter>("all");
  const list = filtered(s.items, filter);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            What's happened in your Courses and Purchases.
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
      <NewNotificationsPill />
      <div className="overflow-hidden rounded-lg border bg-card">
        {list.length === 0 && s.loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Loading from Knock…
          </p>
        ) : list.length === 0 ? (
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

const EMPTY_FEED_KEY = "none";

function StoreFromKnock({ children }: { children: React.ReactNode }) {
  const store = useNotificationStore();
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

export function NotificationsPrototypeProvider({
  knock,
  children,
}: {
  knock: KnockFeedConfig | null;
  children: React.ReactNode;
}) {
  // Knock's client is browser-only; render without it on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!knock || !mounted) {
    return (
      <StoreContext.Provider value={null}>{children}</StoreContext.Provider>
    );
  }
  return (
    <KnockProvider
      key={knock.userId ?? EMPTY_FEED_KEY}
      apiKey={knock.publicKey}
      user={{ id: knock.userId }}
      userToken={knock.userToken}
    >
      <KnockFeedProvider
        feedId={knock.feedChannelId}
        defaultFeedOptions={{
          // compact (the default) drops total_activities and all but one actor
          mode: "rich",
          // one feed for All, Unread and Archived
          archived: "include",
          page_size: 50,
        }}
      >
        <StoreFromKnock>{children}</StoreFromKnock>
      </KnockFeedProvider>
    </KnockProvider>
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
  const variant = fromUrl ?? saved ?? "B"; // B was chosen
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
  const s = useContext(StoreContext);
  const fetcher = useFetcher();
  if (!s) return null;
  const btn =
    "whitespace-nowrap rounded-full px-2 py-0.5 text-xs text-white/80 hover:bg-white/15 hover:text-white";
  const send = (intent: string) =>
    fetcher.submit(
      { intent },
      { method: "post", action: "/api/prototype-knock" }
    );
  return (
    <>
      <button
        className={btn}
        onClick={() => send("one")}
        title="Trigger a real Knock workflow for you"
      >
        + real event
      </button>
      <button
        className={btn}
        onClick={() => send("burst")}
        title="3 replies to one comment, 3 actors"
      >
        + burst ×3
      </button>
      <button
        className={btn}
        onClick={s.cycleMode}
        title="How a live arrival shows"
      >
        arrival: {s.mode}
        {s.held > 0 && ` (${s.held} held)`}
      </button>
      <button className={btn} onClick={s.refetch}>
        refetch
      </button>
      <span className="px-1 text-[10px] text-white/50" title={s.log.join("\n")}>
        knock unread {s.knockUnread} · {s.log[0] ?? ""}
      </span>
    </>
  );
}

export function NewNotificationsPill() {
  const s = useContext(StoreContext);
  if (!s || s.mode !== "pill" || s.held === 0) return null;
  return (
    <button
      onClick={s.showHeld}
      className="sticky top-3 z-20 mx-auto mb-2 flex items-center gap-2 rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white shadow"
    >
      <Bell className="size-3.5" /> {s.held} new Notification
      {s.held === 1 ? "" : "s"} · Show
    </button>
  );
}
