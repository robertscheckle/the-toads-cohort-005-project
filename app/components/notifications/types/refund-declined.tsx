import { CircleX } from "lucide-react";
import { Bold, dataText } from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const refundDeclinedRow: NotificationRowDefinition = {
  icon: CircleX,
  tone: "text-rose-600",
  Sentence: ({ item }) => (
    <>
      Your refund request for <Bold>{dataText(item, "course_title")}</Bold> was
      declined
    </>
  ),
  href: () => "/dashboard",
};
