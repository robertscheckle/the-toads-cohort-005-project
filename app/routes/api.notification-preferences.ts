import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notification-preferences";
import { requireUserId } from "~/lib/access.server";
import { setNotificationTypeEnabled } from "~/lib/notification-preferences.server";
import { NOTIFICATION_TYPES } from "~/lib/notifications";
import { parseFormData } from "~/lib/validation";

// Mutes or unmutes one Notification type for the signed-in person. Used by
// the settings page's switches and the "Mute … Notifications" menu item,
// which post here with fetch(). A refusal is a thrown response whose body is
// the message to show (see readRefusal in ~/lib/notifications).

const preferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const parsed = parseFormData(await request.formData(), preferenceSchema);
  if (!parsed.success) {
    throw data("Invalid Notification type preference.", { status: 400 });
  }

  await setNotificationTypeEnabled(
    String(userId),
    parsed.data.type,
    parsed.data.enabled
  );
  return null;
}
