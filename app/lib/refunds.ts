import { formatPrice } from "~/lib/utils";

// ─── Refund Eligibility ───
// The rules that decide whether a Purchase may receive a Refund Request.
// See GLOSSARY.md for the language: Refund, Refund Request, Refund Window,
// Refund Amount, Refund Eligibility.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundIneligibleReason =
  | "earlier_refund_request"
  | "claimed_seat"
  | "window_closed"
  | "completed_too_much"
  | "watched_too_much";

export type RefundFacts = {
  purchasedAt: Date;
  today: Date;
  hasEarlierRefundRequest: boolean;
  hasClaimedSeat: boolean;
  completedLessonCount: number;
  totalLessonCount: number;
  secondsWatched: number;
};

export type RefundEligibility =
  | { eligible: true; lastDayInWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

// The window is counted in whole calendar days, not hours — a Purchase at
// 23:00 still gets the whole of its fourteenth day.
export function toCalendarDay(when: Date): string {
  const year = when.getFullYear();
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAt: Date): string {
  const lastDay = new Date(purchasedAt);
  lastDay.setDate(lastDay.getDate() + REFUND_WINDOW_DAYS);
  return toCalendarDay(lastDay);
}

export function decideRefundEligibility(facts: RefundFacts): RefundEligibility {
  if (facts.hasEarlierRefundRequest) {
    return { eligible: false, reason: "earlier_refund_request" };
  }

  if (facts.hasClaimedSeat) {
    return { eligible: false, reason: "claimed_seat" };
  }

  const lastDayInWindow = lastDayOfRefundWindow(facts.purchasedAt);
  if (toCalendarDay(facts.today) > lastDayInWindow) {
    return { eligible: false, reason: "window_closed" };
  }

  if (
    facts.totalLessonCount > 0 &&
    facts.completedLessonCount / facts.totalLessonCount >=
      REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "completed_too_much" };
  }

  if (facts.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "watched_too_much" };
  }

  return { eligible: true, lastDayInWindow };
}

export const REFUND_INELIGIBLE_MESSAGES: Record<RefundIneligibleReason, string> =
  {
    earlier_refund_request: "You have already requested a refund for this course.",
    claimed_seat: "A claimed team seat cannot be refunded.",
    window_closed: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
    completed_too_much:
      "You have completed too much of this course to request a refund.",
    watched_too_much:
      "You have watched too much of this course to request a refund.",
  };

// ─── Refund emails ───
// There is no mail transport wired up yet, so built messages go to the server
// log.

export type RefundEmail = { to: string; subject: string; body: string };

export function buildRefundRequestedEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  refundAmount: number;
}): RefundEmail {
  return {
    to: input.studentEmail,
    subject: `Refund requested: ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      `We have received your refund request for "${input.courseTitle}".`,
      `If it is approved, we will refund ${formatPrice(input.refundAmount)}, the amount you paid.`,
      "",
      "An admin reviews every refund request by hand. You do not need to do anything else — we will email you again once it has been decided.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
