import { ReceiptText } from "lucide-react";
import { Bold, actorsPhrase, dataText } from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const refundRequestedRow: NotificationRowDefinition = {
  icon: ReceiptText,
  tone: "text-amber-600",
  Sentence: ({ item }) => (
    <>
      <Bold>{actorsPhrase(item)}</Bold> requested a refund for{" "}
      <Bold>{dataText(item, "course_title")}</Bold>
    </>
  ),
  href: () => "/admin/refunds",
};
