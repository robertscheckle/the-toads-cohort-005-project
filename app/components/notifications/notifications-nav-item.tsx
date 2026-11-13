import { NavLink } from "react-router";
import { Bell } from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotifications } from "./notifications-provider";

/** The sidebar's first item, with Knock's live unread count capped at "9+". */
export function NotificationsNavItem() {
  const { unreadCount } = useNotifications();

  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Bell className="size-4" />
      Notifications
      {unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread`}
          className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </NavLink>
  );
}
