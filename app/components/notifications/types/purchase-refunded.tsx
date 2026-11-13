import { RotateCcw } from "lucide-react";
import { Bold, dataText } from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const purchaseRefundedRow: NotificationRowDefinition = {
  icon: RotateCcw,
  tone: "text-orange-600",
  Sentence: ({ item }) => (
    <>
      <Bold>{dataText(item, "student_name")}</Bold>&apos;s purchase of{" "}
      <Bold>{dataText(item, "course_title")}</Bold> was refunded
    </>
  ),
  href: (item) => `/instructor/${dataText(item, "course_id")}/students`,
};
