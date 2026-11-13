import type { NotificationType } from "~/lib/notifications";
import type { NotificationRowDefinition } from "./row-definition";
import { courseRatedRow } from "./types/course-rated";
import { commentPostedRow } from "./types/comment-posted";
import { commentRepliedRow } from "./types/comment-replied";
import { refundRequestedRow } from "./types/refund-requested";
import { teamSeatClaimedRow } from "./types/team-seat-claimed";
import { coursePurchasedRow } from "./types/course-purchased";
import { refundApprovedRow } from "./types/refund-approved";
import { refundDeclinedRow } from "./types/refund-declined";
import { refundedRow } from "./types/refunded";
import { purchaseRefundedRow } from "./types/purchase-refunded";

// Add a type: create ./types/<workflow-key>.tsx exporting a
// NotificationRowDefinition, then register it here. A type Knock sends that
// isn't in the catalog never gets a row (see toNotificationItem).
const ROWS: Record<NotificationType, NotificationRowDefinition> = {
  "refund-requested": refundRequestedRow,
  "course-rated": courseRatedRow,
  "team-seat-claimed": teamSeatClaimedRow,
  "comment-replied": commentRepliedRow,
  "comment-posted": commentPostedRow,
  "course-purchased": coursePurchasedRow,
  "refund-approved": refundApprovedRow,
  "refund-declined": refundDeclinedRow,
  refunded: refundedRow,
  "purchase-refunded": purchaseRefundedRow,
};

export function rowDefinitionFor(
  type: NotificationType
): NotificationRowDefinition {
  return ROWS[type];
}
