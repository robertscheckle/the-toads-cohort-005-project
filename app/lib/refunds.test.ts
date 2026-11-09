import { describe, it, expect } from "vitest";
import {
  buildRefundRequestedEmail,
  decideRefundEligibility,
  type RefundFacts,
} from "./refunds";

function facts(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return {
    purchasedAt: new Date(2026, 10, 1, 23, 0),
    today: new Date(2026, 10, 5, 12, 0),
    hasEarlierRefundRequest: false,
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
