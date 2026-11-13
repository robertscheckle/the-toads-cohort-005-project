import type { NotificationType } from "~/lib/notifications";

/**
 * Mutes (`enabled` false) or unmutes one type for the signed-in person through
 * /api/notification-preferences. Throws when the action refuses (it throws a
 * response, e.g. for a Mandatory type) or the request fails, so the caller can
 * undo its optimistic state and show a toast.
 */
export async function saveNotificationTypeEnabled(
  type: NotificationType,
  enabled: boolean
): Promise<void> {
  const response = await fetch("/api/notification-preferences", {
    method: "POST",
    body: new URLSearchParams({ type, enabled: String(enabled) }),
  });
  if (!response.ok) {
    throw new Error(
      `Saving the ${type} Notification setting failed (${response.status})`
    );
  }
}

/** The toast shown when saving a Notification setting failed. */
export const SAVE_PREFERENCE_FAILED_MESSAGE =
  "Couldn't save your Notification settings. Please try again.";
