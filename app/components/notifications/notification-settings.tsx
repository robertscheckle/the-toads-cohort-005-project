import { useState } from "react";
import { Switch } from "radix-ui";
import { toast } from "sonner";
import type { NotificationType } from "~/lib/notifications";
import {
  SAVE_PREFERENCE_FAILED_MESSAGE,
  saveNotificationTypeEnabled,
} from "./save-notification-preference";

/** One mutable Notification type as the settings loader returns it. */
export type NotificationSettingRow = {
  type: NotificationType;
  label: string;
  enabled: boolean;
};

/** The settings page's Notifications section: one switch per mutable type. */
export function NotificationSettings({
  settings,
}: {
  settings: NotificationSettingRow[];
}) {
  return (
    <ul className="divide-y">
      {settings.map((setting) => (
        <NotificationSettingSwitch key={setting.type} setting={setting} />
      ))}
    </ul>
  );
}

function NotificationSettingSwitch({
  setting,
}: {
  setting: NotificationSettingRow;
}) {
  const [checked, setChecked] = useState(setting.enabled);
  const id = `notification-setting-${setting.type}`;

  // Optimistic: flip now, flip back if the action refuses or the request fails.
  async function save(next: boolean) {
    setChecked(next);
    try {
      await saveNotificationTypeEnabled(setting.type, next);
    } catch (error) {
      console.error("[notifications] save setting failed:", error);
      setChecked(!next);
      toast.error(SAVE_PREFERENCE_FAILED_MESSAGE);
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <label htmlFor={id} className="text-sm font-medium">
        {setting.label} Notifications
      </label>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={(next) => void save(next)}
        className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary"
      >
        <Switch.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </li>
  );
}
