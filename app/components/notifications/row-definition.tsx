import type { LucideIcon } from "lucide-react";
import type { NotificationItem } from "./notifications-provider";

// How one Notification type renders as a row: a lucide-react icon and tone, the
// sentence (names in <Bold>), and where clicking it goes. One file per type in
// ./types/, registered in ./registry.ts.

export type NotificationRowDefinition = {
  icon: LucideIcon;
  /** Tailwind text colour for the icon on unread rows. */
  tone: string;
  Sentence: (props: { item: NotificationItem }) => React.ReactNode;
  href: (item: NotificationItem) => string;
};

/** Names, Courses and Lessons in a row sentence. */
export function Bold({ children }: { children: React.ReactNode }) {
  return <strong>{children}</strong>;
}

/** A trigger data value as text ("" when missing). */
export function dataText(item: NotificationItem, key: string): string {
  const value = item.data[key];
  return value === undefined || value === null ? "" : String(value);
}

/**
 * The actors as one phrase: "Ana", "Ana and Ben", or "Ana, Ben and 3 others".
 * Uses `totalActors`, since Knock lists at most 10 actor names.
 */
export function actorsPhrase(item: NotificationItem): string {
  const names = item.actors.length > 0 ? item.actors : ["Someone"];
  const total = Math.max(item.totalActors, names.length);
  if (total === 1) return names[0];
  if (total === 2 && names.length >= 2) return `${names[0]} and ${names[1]}`;
  const others = total - 2;
  if (names.length >= 2) {
    return `${names[0]}, ${names[1]} and ${others} ${others === 1 ? "other" : "others"}`;
  }
  return `${names[0]} and ${total - 1} ${total - 1 === 1 ? "other" : "others"}`;
}
