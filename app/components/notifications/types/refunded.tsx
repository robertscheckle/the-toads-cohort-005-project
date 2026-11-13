import { Banknote } from "lucide-react";
import { Bold, dataText } from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const refundedRow: NotificationRowDefinition = {
  icon: Banknote,
  tone: "text-emerald-600",
  Sentence: ({ item }) => (
    <>
      Your refund for <Bold>{dataText(item, "course_title")}</Bold> was sent.{" "}
      {item.data.is_team_purchase === true
        ? "Its unclaimed Team Seats are no longer available."
        : "Your access to the Course has ended."}
    </>
  ),
  href: () => "/dashboard",
};
