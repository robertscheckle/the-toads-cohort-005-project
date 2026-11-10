import { describe, it, expect } from "vitest";
import { RefundStatus } from "~/db/schema";
import {
  buildRefundApprovedEmail,
  buildRefundDeclinedEmail,
  buildRefundRequestedEmail,
  buildRefundedEmail,
  daysLeftInRefundWindow,
  decideRefundEligibility,
  decideRefundTransition,
  decideTeamSeatBlock,
  type RefundFacts,
} from "./refunds";

function facts(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return {
    purchasedAt: new Date(2026, 10, 1, 23, 0),
    today: new Date(2026, 10, 5, 12, 0),
    hasEarlierRefundRequest: false,
    hasEarlierRefundForCourse: false,
    hasClaimedSeat: false,
    completedLessonCount: 0,
    totalLessonCount: 10,
    secondsWatched: 0,
    ...overrides,
  };
}

describe("decideRefundEligibility", () => {
  it("is eligible inside the Refund Window with little progress", () => {
    expect(decideRefundEligibility(facts())).toEqual({
      eligible: true,
      lastDayInWindow: "2026-11-15",
    });
  });

  it("includes the whole of the fourteenth day", () => {
    const result = decideRefundEligibility(
      facts({ today: new Date(2026, 10, 15, 23, 59) })
    );
    expect(result.eligible).toBe(true);
  });

  it("closes the day after the fourteenth day", () => {
    expect(
      decideRefundEligibility(facts({ today: new Date(2026, 10, 16, 0, 1) }))
    ).toEqual({ eligible: false, reason: "window_closed" });
  });

  it("allows only one Refund Request per Purchase, whatever its status", () => {
    expect(
      decideRefundEligibility(facts({ hasEarlierRefundRequest: true }))
    ).toEqual({ eligible: false, reason: "earlier_refund_request" });
  });

  it("never refunds the same Course twice, even on a new Purchase", () => {
    expect(
      decideRefundEligibility(facts({ hasEarlierRefundForCourse: true }))
    ).toEqual({ eligible: false, reason: "earlier_refund_for_course" });
  });

  it("refuses a claimed team seat", () => {
    expect(decideRefundEligibility(facts({ hasClaimedSeat: true }))).toEqual({
      eligible: false,
      reason: "claimed_seat",
    });
  });

  it("refuses once half the lessons are completed", () => {
    expect(
      decideRefundEligibility(facts({ completedLessonCount: 5 }))
    ).toEqual({ eligible: false, reason: "completed_too_much" });
    expect(decideRefundEligibility(facts({ completedLessonCount: 4 })).eligible)
      .toBe(true);
  });

  it("refuses once two hours have been watched", () => {
    expect(
      decideRefundEligibility(facts({ secondsWatched: 2 * 60 * 60 }))
    ).toEqual({ eligible: false, reason: "watched_too_much" });
    expect(
      decideRefundEligibility(facts({ secondsWatched: 2 * 60 * 60 - 1 }))
        .eligible
    ).toBe(true);
  });

  it("ignores the completion rule for a course with no lessons", () => {
    expect(
      decideRefundEligibility(facts({ totalLessonCount: 0 })).eligible
    ).toBe(true);
  });
});

describe("buildRefundRequestedEmail", () => {
  const email = buildRefundRequestedEmail({
    studentName: "Liam",
    studentEmail: "liam@example.com",
    courseTitle: "Introduction to TypeScript",
    refundAmount: 7900,
  });

  it("is titled with the Refund Requested status", () => {
    expect(email.to).toBe("liam@example.com");
    expect(email.subject).toBe("Refund requested: Introduction to TypeScript");
  });

  it("quotes the Refund Amount and avoids retired terms", () => {
    expect(email.body).toContain("$79");
    expect(email.body).not.toMatch(/reversal|chargeback|cancel/i);
  });
});

describe("daysLeftInRefundWindow", () => {
  const purchasedAt = new Date(2026, 10, 1, 23, 0);

  it("counts today and the fourteenth day", () => {
    expect(daysLeftInRefundWindow(purchasedAt, new Date(2026, 10, 1, 23, 30))).toBe(15);
    expect(daysLeftInRefundWindow(purchasedAt, new Date(2026, 10, 15, 9, 0))).toBe(1);
  });

  it("is zero once the window has closed", () => {
    expect(daysLeftInRefundWindow(purchasedAt, new Date(2026, 10, 16, 0, 1))).toBe(0);
  });
});

describe("decideRefundTransition", () => {
  it("approves and declines only a Requested request", () => {
    expect(decideRefundTransition(RefundStatus.Requested, "approve")).toEqual({
      ok: true,
      next: RefundStatus.Approved,
    });
    expect(decideRefundTransition(RefundStatus.Requested, "decline")).toEqual({
      ok: true,
      next: RefundStatus.Declined,
    });

    for (const status of [
      RefundStatus.Approved,
      RefundStatus.Declined,
      RefundStatus.Refunded,
    ]) {
      expect(decideRefundTransition(status, "approve").ok).toBe(false);
      expect(decideRefundTransition(status, "decline").ok).toBe(false);
    }
  });

  it("marks only an Approved request Refunded", () => {
    expect(
      decideRefundTransition(RefundStatus.Approved, "mark_refunded")
    ).toEqual({ ok: true, next: RefundStatus.Refunded });

    for (const status of [
      RefundStatus.Requested,
      RefundStatus.Declined,
      RefundStatus.Refunded,
    ]) {
      expect(decideRefundTransition(status, "mark_refunded").ok).toBe(false);
    }
  });

  it("explains a rejected transition in status words", () => {
    expect(
      decideRefundTransition(RefundStatus.Requested, "mark_refunded")
    ).toEqual({
      ok: false,
      message:
        "Only a refund request that is Approved can be marked Refunded; this one is Requested.",
    });
  });
});

describe("decideTeamSeatBlock", () => {
  it("blocks claims while a Refund Request is Requested or Approved", () => {
    expect(decideTeamSeatBlock(RefundStatus.Requested)).toBe("refund_in_progress");
    expect(decideTeamSeatBlock(RefundStatus.Approved)).toBe("refund_in_progress");
  });

  it("ends unclaimed seats once Refunded", () => {
    expect(decideTeamSeatBlock(RefundStatus.Refunded)).toBe("refunded");
  });

  it("leaves seats available with no request or a Declined one", () => {
    expect(decideTeamSeatBlock(null)).toBeNull();
    expect(decideTeamSeatBlock(RefundStatus.Declined)).toBeNull();
  });
});

const student = {
  studentName: "Liam",
  studentEmail: "liam@example.com",
  courseTitle: "Introduction to TypeScript",
};

const RETIRED_TERMS = /reversal|chargeback|cancel|pending/i;

describe("buildRefundApprovedEmail", () => {
  const email = buildRefundApprovedEmail({ ...student, refundAmount: 7900 });

  it("is titled with the Approved status and quotes the Refund Amount", () => {
    expect(email.to).toBe("liam@example.com");
    expect(email.subject).toBe("Refund approved: Introduction to TypeScript");
    expect(email.body).toContain("$79");
    expect(email.body).toMatch(/keep access/);
    expect(`${email.subject} ${email.body}`).not.toMatch(RETIRED_TERMS);
  });
});

describe("buildRefundDeclinedEmail", () => {
  const email = buildRefundDeclinedEmail(student);

  it("is titled with the Declined status and says it is final", () => {
    expect(email.subject).toBe("Refund declined: Introduction to TypeScript");
    expect(email.body).toMatch(/final/);
    expect(`${email.subject} ${email.body}`).not.toMatch(RETIRED_TERMS);
  });
});

describe("buildRefundedEmail", () => {
  it("tells a Student their access has ended", () => {
    const email = buildRefundedEmail({
      ...student,
      refundAmount: 7900,
      isTeamPurchase: false,
    });
    expect(email.subject).toBe("Refunded: Introduction to TypeScript");
    expect(email.body).toContain("$79");
    expect(email.body).toContain(
      'Your access to "Introduction to TypeScript" has ended.'
    );
    expect(`${email.subject} ${email.body}`).not.toMatch(RETIRED_TERMS);
  });

  it("tells a team buyer their unclaimed Team Seats are no longer available", () => {
    const email = buildRefundedEmail({
      ...student,
      refundAmount: 7900,
      isTeamPurchase: true,
    });
    expect(email.body).toContain(
      "The unclaimed Team Seats from this Purchase are no longer available."
    );
    expect(email.body).not.toMatch(/access .* has ended/);
  });
});
