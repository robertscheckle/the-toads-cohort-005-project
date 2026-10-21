import { formatPrice } from "~/lib/utils";
import { RefundStatus } from "~/db/schema";

// ─── Refund Eligibility ───
// The rules that decide whether a Purchase may receive a Refund Request.
// See GLOSSARY.md for the language: Refund, Refund Request, Refund Window,
// Refund Amount, Refund Eligibility.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundIneligibleReason =
  | "earlier_refund_request"
  | "earlier_refund_for_course"
  | "claimed_seat"
  | "window_closed"
  | "completed_too_much"
  | "watched_too_much";

export type RefundFacts = {
  purchasedAt: Date;
  today: Date;
  hasEarlierRefundRequest: boolean;
  /** A Refunded Refund Request on any earlier Purchase of the same Course. */
  hasEarlierRefundForCourse: boolean;
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

/**
 * Whole calendar days left in the Refund Window, counting today; 0 once it has
 * closed. On the last day it is 1.
 */
export function daysLeftInRefundWindow(purchasedAt: Date, today: Date): number {
  const lastDay = Date.parse(lastDayOfRefundWindow(purchasedAt));
  const todayDay = Date.parse(toCalendarDay(today));
  return Math.max(0, Math.round((lastDay - todayDay) / 86_400_000) + 1);
}

export function decideRefundEligibility(facts: RefundFacts): RefundEligibility {
  if (facts.hasEarlierRefundRequest) {
    return { eligible: false, reason: "earlier_refund_request" };
  }

  // A Student who bought the Course again after a Refund never gets a second
  // one, however little they have watched.
  if (facts.hasEarlierRefundForCourse) {
    return { eligible: false, reason: "earlier_refund_for_course" };
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
    earlier_refund_for_course:
      "You have already been refunded for this course once, so it cannot be refunded again.",
    claimed_seat: "A claimed team seat cannot be refunded.",
    window_closed: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
    completed_too_much:
      "You have completed too much of this course to request a refund.",
    watched_too_much:
      "You have watched too much of this course to get a refund.",
  };

// ─── Refund decisions ───
// An Admin moves a Refund Request through its statuses:
//
//   Requested ──► Approved ──► Refunded
//       └───────► Declined

export type RefundDecision = "approve" | "decline" | "mark_refunded";

const DECISIONS: Record<
  RefundDecision,
  { from: RefundStatus; to: RefundStatus; label: string }
> = {
  approve: {
    from: RefundStatus.Requested,
    to: RefundStatus.Approved,
    label: "approved",
  },
  decline: {
    from: RefundStatus.Requested,
    to: RefundStatus.Declined,
    label: "declined",
  },
  mark_refunded: {
    from: RefundStatus.Approved,
    to: RefundStatus.Refunded,
    label: "marked Refunded",
  },
};

export type RefundTransition =
  | { ok: true; next: RefundStatus }
  | { ok: false; message: string };

export function decideRefundTransition(
  current: RefundStatus,
  decision: RefundDecision
): RefundTransition {
  const rule = DECISIONS[decision];
  if (current !== rule.from) {
    return {
      ok: false,
      message: `Only a refund request that is ${REFUND_STATUS_LABELS[rule.from]} can be ${rule.label}; this one is ${REFUND_STATUS_LABELS[current]}.`,
    };
  }
  return { ok: true, next: rule.to };
}

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  [RefundStatus.Requested]: "Requested",
  [RefundStatus.Approved]: "Approved",
  [RefundStatus.Declined]: "Declined",
  [RefundStatus.Refunded]: "Refunded",
};

// ─── Team Seats under a Refund Request ───
// A Team Seat cannot be claimed while its Purchase has a Requested or Approved
// Refund Request, and unclaimed Team Seats are no longer available once the
// Purchase is Refunded. A Declined request leaves the seats as they were.

export type TeamSeatBlock = "refund_in_progress" | "refunded";

export function decideTeamSeatBlock(
  refundStatus: RefundStatus | null
): TeamSeatBlock | null {
  switch (refundStatus) {
    case RefundStatus.Requested:
    case RefundStatus.Approved:
      return "refund_in_progress";
    case RefundStatus.Refunded:
      return "refunded";
    default:
      return null;
  }
}

export const TEAM_SEAT_BLOCK_MESSAGES: Record<TeamSeatBlock, string> = {
  refund_in_progress:
    "This seat cannot be claimed right now because the purchase it came from has a refund request being reviewed. Please try again later or ask the person who shared this link.",
  refunded:
    "This seat is no longer available because the purchase it came from was refunded.",
};

// Short labels for the buyer's team page.
export const TEAM_SEAT_BLOCK_LABELS: Record<
  TeamSeatBlock,
  { label: string; detail: string }
> = {
  refund_in_progress: {
    label: "On hold",
    detail: "A refund request for this purchase is being reviewed.",
  },
  refunded: {
    label: "No longer available",
    detail: "This purchase was refunded.",
  },
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

export function buildRefundApprovedEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  refundAmount: number;
}): RefundEmail {
  return {
    to: input.studentEmail,
    subject: `Refund approved: ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      `An admin has approved your refund request for "${input.courseTitle}".`,
      `We are sending ${formatPrice(input.refundAmount)}, the amount you paid, back to you now.`,
      "",
      "You keep access to the course until the money has been sent. We will email you again when it has.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export function buildRefundDeclinedEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
}): RefundEmail {
  return {
    to: input.studentEmail,
    subject: `Refund declined: ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      `An admin has declined your refund request for "${input.courseTitle}".`,
      "Nothing will be paid back, and this decision is final. You keep your access to the course.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export function buildRefundedEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  refundAmount: number;
  isTeamPurchase: boolean;
}): RefundEmail {
  const accessLine = input.isTeamPurchase
    ? "The unclaimed Team Seats from this Purchase are no longer available."
    : `Your access to "${input.courseTitle}" has ended.`;

  return {
    to: input.studentEmail,
    subject: `Refunded: ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      `We have sent ${formatPrice(input.refundAmount)}, the amount you paid for "${input.courseTitle}", back to you.`,
      accessLine,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
