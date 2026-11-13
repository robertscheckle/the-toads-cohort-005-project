import { Bell } from "lucide-react";
import type { NotificationType } from "~/lib/notifications";
import type { NotificationRowDefinition } from "./row-definition";
import { commentPostedRow } from "./types/comment-posted";
import { commentRepliedRow } from "./types/comment-replied";
import { refundRequestedRow } from "./types/refund-requested";

// Add a type: create ./types/<workflow-key>.tsx exporting a
// NotificationRowDefinition, then register it here.
const ROWS: Partial<Record<NotificationType, NotificationRowDefinition>> = {
  "refund-requested": refundRequestedRow,
  "comment-replied": commentRepliedRow,
  "comment-posted": commentPostedRow,
};

/** For a type this build has no row for yet: a plain row that opens the list. */
const FALLBACK_ROW: NotificationRowDefinition = {
  icon: Bell,
  tone: "text-sky-600",
  Sentence: () => "You have a new Notification",
  href: () => "/notifications",
};

export function rowDefinitionFor(
  type: NotificationType | null
): NotificationRowDefinition {
  return (type && ROWS[type]) || FALLBACK_ROW;
}
