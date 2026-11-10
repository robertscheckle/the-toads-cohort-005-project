import { RefundStatus } from "~/db/schema";
import { REFUND_STATUS_LABELS } from "~/lib/refunds";
import { cn } from "~/lib/utils";

const STATUS_BADGE: Record<RefundStatus, string> = {
  [RefundStatus.Requested]:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  [RefundStatus.Approved]:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  [RefundStatus.Declined]:
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  [RefundStatus.Refunded]:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_BADGE[status]
      )}
    >
      {REFUND_STATUS_LABELS[status]}
    </span>
  );
}
