import { CircleCheck } from "lucide-react";
import { Bold, dataText } from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const refundApprovedRow: NotificationRowDefinition = {
  icon: CircleCheck,
  tone: "text-emerald-600",
  Sentence: ({ item }) => (
    <>
      Your refund for <Bold>{dataText(item, "course_title")}</Bold> was
      approved. Payment is on its way.
    </>
  ),
  href: () => "/dashboard",
};
