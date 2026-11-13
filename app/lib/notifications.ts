// ─── Notification catalog ───
// Shared by the server (Notifier, events module) and the client (rows, settings).
// The type key is the Knock workflow key. See spec #25 for the catalog.

export const NOTIFICATION_TYPES = [
  "refund-requested",
  "refund-approved",
  "refund-declined",
  "refunded",
  "comment-replied",
  "comment-posted",
  "course-purchased",
  "purchase-refunded",
  "course-rated",
  "team-seat-claimed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  "refund-requested": "Refund Requested",
  "refund-approved": "Refund Approved",
  "refund-declined": "Refund Declined",
  refunded: "Refunded",
  "comment-replied": "Comment Replied",
  "comment-posted": "Comment Posted",
  "course-purchased": "Course Purchased",
  "purchase-refunded": "Purchase Refunded",
  "course-rated": "Course Rated",
  "team-seat-claimed": "Team Seat Claimed",
};

/** Mandatory Notification types can't be muted; no preference is ever written for them. */
export const MANDATORY_NOTIFICATION_TYPES: readonly NotificationType[] = [
  "refund-requested",
  "refund-approved",
  "refund-declined",
  "refunded",
];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export function isMandatoryNotificationType(type: NotificationType): boolean {
  return MANDATORY_NOTIFICATION_TYPES.includes(type);
}

/**
 * Trigger data is kept flat and short: Knock drops nested objects and cuts
 * strings at 256 characters in grouped runs.
 */
export type NotificationData = Record<string, string | number | boolean | null>;

/** Knock's feed channel config, passed from the app layout loader to the client. */
export type KnockFeedConfig = {
  publicKey: string;
  feedChannelId: string;
  userId: string;
  userToken: string;
};
