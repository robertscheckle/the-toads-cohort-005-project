import { Bell } from "lucide-react";
import type { NotificationType } from "~/lib/notifications";
import type { NotificationRowDefinition } from "./row-definition";
import { courseRatedRow } from "./types/course-rated";
import { refundRequestedRow } from "./types/refund-requested";
import { coursePurchasedRow } from "./types/course-purchased";

// Add a type: create ./types/<workflow-key>.tsx exporting a
// NotificationRowDefinition, then register it here.
const ROWS: Partial<Record<NotificationType, NotificationRowDefinition>> = {
  "refund-requested": refundRequestedRow,
  "course-rated": courseRatedRow,
  "course-purchased": coursePurchasedRow,
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
