import { UserRole } from "~/db/schema";
import {
  isMandatoryNotificationType,
  MANDATORY_MUTE_MESSAGE,
  NOTIFICATION_TYPE_LABELS,
  type NotificationType,
} from "~/lib/notifications";
import { defaultNotifier, neverThrow, type Notifier } from "./notifier.server";

// ─── Muted Notification types ───
// What the settings page's Notifications section shows, and the one place
// that writes a person's type preferences. Mandatory types are never offered
// and never written.

/** Mutable types everyone can receive. */
const EVERYONE_TYPES: NotificationType[] = [
  "comment-replied",
  "team-seat-claimed",
];

/** Mutable types only Instructors receive (about their own Courses). */
const INSTRUCTOR_TYPES: NotificationType[] = [
  "comment-posted",
  "course-purchased",
  "purchase-refunded",
  "course-rated",
];

export type NotificationSetting = {
  type: NotificationType;
  label: string;
  enabled: boolean;
};

/** The person's mutable types, in display order, with whether each is on. */
export async function getNotificationSettings(
  userId: string,
  role: UserRole,
  notifier: Notifier = defaultNotifier()
): Promise<NotificationSetting[]> {
  const types =
    role === UserRole.Instructor
      ? [...EVERYONE_TYPES, ...INSTRUCTOR_TYPES]
      : EVERYONE_TYPES;
  const preferences = await neverThrow(notifier).getPreferences(userId);
  return types.map((type) => ({
    type,
    label: NOTIFICATION_TYPE_LABELS[type],
    enabled: preferences[type] ?? true,
  }));
}

export type SetNotificationTypeResult =
  { ok: true } | { ok: false; message: string };

/**
 * Mutes (`enabled` false) or unmutes one type for one person. Refuses
 * Mandatory types without writing anything. Affects only future
 * Notifications, never ones already received, never email.
 */
export async function setNotificationTypeEnabled(
  userId: string,
  type: NotificationType,
  enabled: boolean,
  notifier: Notifier = defaultNotifier()
): Promise<SetNotificationTypeResult> {
  if (isMandatoryNotificationType(type)) {
    return { ok: false, message: MANDATORY_MUTE_MESSAGE };
  }
  await neverThrow(notifier).setPreference(userId, type, enabled);
  return { ok: true };
}
