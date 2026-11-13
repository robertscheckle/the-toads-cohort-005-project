import { ShoppingCart } from "lucide-react";
import { Bold, actorsPhrase, dataText } from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const coursePurchasedRow: NotificationRowDefinition = {
  icon: ShoppingCart,
  tone: "text-emerald-600",
  Sentence: ({ item }) => {
    const course = <Bold>{dataText(item, "course_title")}</Bold>;
    if (item.totalActivities > 1) {
      return (
        <>
          <Bold>{actorsPhrase(item)}</Bold> made {item.totalActivities}{" "}
          Purchases of {course}
        </>
      );
    }
    const seats = Number(item.data.team_seats ?? 0);
    if (seats > 0) {
      return (
        <>
          <Bold>{actorsPhrase(item)}</Bold> bought {seats}{" "}
          {seats === 1 ? "Team Seat" : "Team Seats"} in {course}
        </>
      );
    }
    return (
      <>
        <Bold>{actorsPhrase(item)}</Bold> bought {course}
      </>
    );
  },
  href: (item) => dataText(item, "url") || "/notifications",
};
