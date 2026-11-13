import { Users } from "lucide-react";
import type { NotificationItem } from "../notifications-provider";
import {
  Bold,
  actorsPhrase,
  dataText,
  withLatestActorFirst,
} from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

/**
 * The newest "n of m claimed" in the Notification. A Grouped Notification
 * carries one activity per claim, so take the highest count among them.
 */
function claimedSeats(item: NotificationItem): number {
  const counts = [
    item.data.claimed_seats,
    ...(item.feedItem.activities ?? []).map(
      (activity) => activity.data?.claimed_seats
    ),
  ].filter((value): value is number => typeof value === "number");
  return counts.length > 0 ? Math.max(...counts) : 0;
}

export const teamSeatClaimedRow: NotificationRowDefinition = {
  icon: Users,
  tone: "text-emerald-600",
  Sentence: ({ item }) => (
    <>
      <Bold>{actorsPhrase(withLatestActorFirst(item, "claimer_name"))}</Bold>{" "}
      claimed {item.totalActivities > 1 ? "Team Seats" : "a Team Seat"} in{" "}
      <Bold>{dataText(item, "course_title")}</Bold> ({claimedSeats(item)} of{" "}
      {dataText(item, "total_seats")} claimed)
    </>
  ),
  href: () => "/team",
};
