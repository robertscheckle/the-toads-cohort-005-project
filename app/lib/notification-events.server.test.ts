import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "~/test/setup";
import {
  categories,
  coupons,
  courseRatings,
  courses,
  enrollments,
  purchases,
  refunds,
  teamMembers,
  teams,
  users,
  CourseStatus,
  RefundStatus,
  TeamMemberRole,
  UserRole,
} from "~/db/schema";
import { recordingNotifier } from "./notifier.server";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  notifyRefundDecided,
  notifyRefundRequested,
  notifyTeamSeatClaimed,
} from "./notification-events.server";
import { applyRefundDecision } from "./refunds.server";
import { notifyCoursePurchased } from "./notification-events.server";
import { notifyCourseRated } from "./notification-events.server";

function addUser(name: string, role: UserRole) {
  return testDb
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

function seed() {
  const ada = addUser("Ada", UserRole.Admin);
  const alan = addUser("Alan", UserRole.Admin);
  const ivy = addUser("Ivy", UserRole.Instructor);
  const liam = addUser("Liam", UserRole.Student);
  const category = testDb
    .insert(categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();
  const course = testDb
    .insert(courses)
    .values({
      title: "Introduction to TypeScript",
      slug: "intro-ts",
      description: "Types",
      salesCopy: "Buy it",
      instructorId: ivy.id,
      categoryId: category.id,
      status: CourseStatus.Published,
      price: 7900,
    })
    .returning()
    .get();
  return { ada, alan, ivy, liam, course };
}

function requestRefund(buyerId: number, courseId: number) {
  const purchase = testDb
    .insert(purchases)
    .values({ userId: buyerId, courseId, amountPaid: 7900 })
    .returning()
    .get();
  testDb.insert(enrollments).values({ userId: buyerId, courseId }).run();
  return testDb
    .insert(refunds)
    .values({
      purchaseId: purchase.id,
      status: RefundStatus.Requested,
      reason: "Not what I expected.",
    })
    .returning()
    .get();
}

let f: ReturnType<typeof seed>;

beforeEach(() => {
  testDb = createTestDb();
  f = seed();
});

describe("notifyRefundRequested", () => {
  it("sends one Refund Requested Notification to every Admin, from the Student", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    const notifier = recordingNotifier();

    await notifyRefundRequested(refund.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "refund-requested",
        recipients: [
          { id: String(f.ada.id), name: "Ada" },
          { id: String(f.alan.id), name: "Alan" },
        ],
        actor: { id: String(f.liam.id), name: "Liam" },
        data: {
          refund_request_id: refund.id,
          student_name: "Liam",
          course_title: "Introduction to TypeScript",
          url: "/admin/refunds",
        },
      },
    ]);
  });

  it("leaves out an Admin who requests a Refund on their own Purchase", async () => {
    const refund = requestRefund(f.ada.id, f.course.id);
    const notifier = recordingNotifier();

    await notifyRefundRequested(refund.id, notifier);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]).toMatchObject({
      type: "refund-requested",
      recipients: [{ id: String(f.alan.id), name: "Alan" }],
      actor: { id: String(f.ada.id), name: "Ada" },
    });
  });

  it("sends nothing when the only Admin requested the Refund", async () => {
    testDb.delete(users).where(eq(users.id, f.alan.id)).run();
    const refund = requestRefund(f.ada.id, f.course.id);
    const notifier = recordingNotifier();

    await notifyRefundRequested(refund.id, notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("doesn't throw when the Notifier fails, and logs the type and recipients", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    const failing = recordingNotifier();
    failing.notify = async () => {
      throw new Error("Knock is down");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyRefundRequested(refund.id, failing)
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        `refund-requested to [${f.ada.id}, ${f.alan.id}]`
      ),
      expect.any(Error)
    );
    log.mockRestore();
  });
});

// ─── Team Seat Claimed ───

/** A team Purchase of `seats` Team Seats by `buyerId`; returns the seats. */
function buyTeamSeats(buyerId: number, courseId: number, seats: number) {
  const purchase = testDb
    .insert(purchases)
    .values({ userId: buyerId, courseId, amountPaid: 7900 * seats })
    .returning()
    .get();
  const team = testDb.insert(teams).values({}).returning().get();
  return Array.from({ length: seats }, (_, index) =>
    testDb
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId,
        code: `SEAT-${purchase.id}-${index}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
}

/** `userId` claims Team Seat `couponId` (as the redeem action does). */
function claimSeat(couponId: number, userId: number) {
  testDb
    .update(coupons)
    .set({ redeemedByUserId: userId, redeemedAt: new Date().toISOString() })
    .where(eq(coupons.id, couponId))
    .run();
}

describe("notifyTeamSeatClaimed", () => {
  it("tells the team Purchase's buyer who claimed a Team Seat, with n of m claimed", async () => {
    const buyer = addUser("Bea", UserRole.Student);
    const seats = buyTeamSeats(buyer.id, f.course.id, 3);
    claimSeat(seats[0].id, f.liam.id);
    const notifier = recordingNotifier();

    await notifyTeamSeatClaimed(seats[0].id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "team-seat-claimed",
        recipients: [{ id: String(buyer.id), name: "Bea" }],
        actor: { id: String(f.liam.id), name: "Liam" },
        data: {
          coupon_id: seats[0].id,
          purchase_id: seats[0].purchaseId,
          claimer_name: "Liam",
          course_title: "Introduction to TypeScript",
          claimed_seats: 1,
          total_seats: 3,
          url: "/team",
        },
      },
    ]);
  });

  it("counts the seats already claimed, including the buyer's own", async () => {
    const buyer = addUser("Bea", UserRole.Student);
    const seats = buyTeamSeats(buyer.id, f.course.id, 5);
    claimSeat(seats[0].id, buyer.id);
    claimSeat(seats[1].id, f.liam.id);
    const max = addUser("Max", UserRole.Student);
    claimSeat(seats[2].id, max.id);
    const notifier = recordingNotifier();

    await notifyTeamSeatClaimed(seats[2].id, notifier);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]).toMatchObject({
      type: "team-seat-claimed",
      recipients: [{ id: String(buyer.id), name: "Bea" }],
      actor: { id: String(max.id), name: "Max" },
      data: { claimer_name: "Max", claimed_seats: 3, total_seats: 5 },
    });
  });

  it("only counts the seats of that team Purchase", async () => {
    const buyer = addUser("Bea", UserRole.Student);
    const otherPurchase = buyTeamSeats(buyer.id, f.course.id, 4);
    claimSeat(otherPurchase[0].id, f.ivy.id);
    const seats = buyTeamSeats(buyer.id, f.course.id, 2);
    claimSeat(seats[1].id, f.liam.id);
    const notifier = recordingNotifier();

    await notifyTeamSeatClaimed(seats[1].id, notifier);

    expect(notifier.calls[0]).toMatchObject({
      data: {
        purchase_id: seats[1].purchaseId,
        claimed_seats: 1,
        total_seats: 2,
      },
    });
  });

  it("sends nothing when the buyer claims their own Team Seat", async () => {
    const buyer = addUser("Bea", UserRole.Student);
    const seats = buyTeamSeats(buyer.id, f.course.id, 3);
    claimSeat(seats[0].id, buyer.id);
    const notifier = recordingNotifier();

    await notifyTeamSeatClaimed(seats[0].id, notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("sends nothing for a Team Seat nobody has claimed", async () => {
    const buyer = addUser("Bea", UserRole.Student);
    const seats = buyTeamSeats(buyer.id, f.course.id, 2);
    const notifier = recordingNotifier();

    await notifyTeamSeatClaimed(seats[0].id, notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("doesn't throw when the Notifier fails", async () => {
    const buyer = addUser("Bea", UserRole.Student);
    const seats = buyTeamSeats(buyer.id, f.course.id, 2);
    claimSeat(seats[0].id, f.liam.id);
    const failing = recordingNotifier();
    failing.notify = async () => {
      throw new Error("Knock is down");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyTeamSeatClaimed(seats[0].id, failing)
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(`team-seat-claimed to [${buyer.id}]`),
      expect.any(Error)
    );
    log.mockRestore();
  });
});

describe("notifyCoursePurchased", () => {
  function buy(buyerId: number, courseId: number) {
    return testDb
      .insert(purchases)
      .values({ userId: buyerId, courseId, amountPaid: 7900 })
      .returning()
      .get();
  }

  it("tells the Instructor who owns the Course about a personal Purchase", async () => {
    const purchase = buy(f.liam.id, f.course.id);
    const notifier = recordingNotifier();

    await notifyCoursePurchased(purchase.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "course-purchased",
        recipients: [{ id: String(f.ivy.id), name: "Ivy" }],
        actor: { id: String(f.liam.id), name: "Liam" },
        data: {
          purchase_id: purchase.id,
          course_id: f.course.id,
          buyer_name: "Liam",
          course_title: "Introduction to TypeScript",
          team_seats: 0,
          url: `/instructor/${f.course.id}/students`,
        },
      },
    ]);
  });

  function buyTeamSeats(buyerId: number, courseId: number, seats: number) {
    const purchase = buy(buyerId, courseId);
    const team = testDb.insert(teams).values({}).returning().get();
    testDb
      .insert(teamMembers)
      .values({ teamId: team.id, userId: buyerId, role: TeamMemberRole.Admin })
      .run();
    for (let i = 0; i < seats; i++) {
      testDb
        .insert(coupons)
        .values({
          teamId: team.id,
          courseId,
          code: `seat-${purchase.id}-${i}`,
          purchaseId: purchase.id,
        })
        .run();
    }
    return purchase;
  }

  it("tells the Instructor how many Team Seats a team Purchase bought", async () => {
    const purchase = buyTeamSeats(f.liam.id, f.course.id, 3);
    const notifier = recordingNotifier();

    await notifyCoursePurchased(purchase.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "course-purchased",
        recipients: [{ id: String(f.ivy.id), name: "Ivy" }],
        actor: { id: String(f.liam.id), name: "Liam" },
        data: {
          purchase_id: purchase.id,
          course_id: f.course.id,
          buyer_name: "Liam",
          course_title: "Introduction to TypeScript",
          team_seats: 3,
          url: `/instructor/${f.course.id}/students`,
        },
      },
    ]);
  });

  it("sends nothing when the Instructor buys their own Course", async () => {
    const personal = buy(f.ivy.id, f.course.id);
    const team = buyTeamSeats(f.ivy.id, f.course.id, 2);
    const notifier = recordingNotifier();

    await notifyCoursePurchased(personal.id, notifier);
    await notifyCoursePurchased(team.id, notifier);

    expect(notifier.calls).toEqual([]);
  });
});

function rate(userId: number, courseId: number, rating: number) {
  return testDb
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .returning()
    .get();
}

describe("notifyCourseRated", () => {
  it("sends a first rating to the Instructor who owns the Course, from the Student", async () => {
    const rating = rate(f.liam.id, f.course.id, 4);
    const notifier = recordingNotifier();

    await notifyCourseRated(rating.id, "first", notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "course-rated",
        recipients: [{ id: String(f.ivy.id), name: "Ivy" }],
        actor: { id: String(f.liam.id), name: "Liam" },
        data: {
          course_rating_id: rating.id,
          course_id: f.course.id,
          course_title: "Introduction to TypeScript",
          student_name: "Liam",
          rating: 4,
          url: `/instructor/${f.course.id}`,
        },
      },
    ]);
  });

  it("sends nothing when a Student edits an existing rating", async () => {
    const rating = rate(f.liam.id, f.course.id, 2);
    const notifier = recordingNotifier();

    await notifyCourseRated(rating.id, "edit", notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("sends nothing when the Instructor rates their own Course", async () => {
    const rating = rate(f.ivy.id, f.course.id, 5);
    const notifier = recordingNotifier();

    await notifyCourseRated(rating.id, "first", notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("doesn't throw when the Notifier fails", async () => {
    const rating = rate(f.liam.id, f.course.id, 3);
    const failing = recordingNotifier();
    failing.notify = async () => {
      throw new Error("Knock is down");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyCourseRated(rating.id, "first", failing)
    ).resolves.toBeUndefined();

    log.mockRestore();
  });
});

describe("notifyRefundDecided", () => {
  it("approve: tells the Student and marks the Refund Requested Notification read for every Admin", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    applyRefundDecision(refund.id, "approve", f.ada.id);
    const notifier = recordingNotifier();

    await notifyRefundDecided(refund.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "refund-approved",
        recipients: [{ id: String(f.liam.id), name: "Liam" }],
        actor: { id: String(f.ada.id), name: "Ada" },
        data: {
          refund_request_id: refund.id,
          course_title: "Introduction to TypeScript",
          url: "/dashboard",
        },
      },
      {
        operation: "markReadWhere",
        type: "refund-requested",
        recipientIds: [String(f.ada.id), String(f.alan.id)],
        filter: { refund_request_id: refund.id },
      },
    ]);
  });

  it("decline: tells the Student and marks the Refund Requested Notification read for every Admin", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    applyRefundDecision(refund.id, "decline", f.alan.id);
    const notifier = recordingNotifier();

    await notifyRefundDecided(refund.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "refund-declined",
        recipients: [{ id: String(f.liam.id), name: "Liam" }],
        actor: { id: String(f.alan.id), name: "Alan" },
        data: {
          refund_request_id: refund.id,
          course_title: "Introduction to TypeScript",
          url: "/dashboard",
        },
      },
      {
        operation: "markReadWhere",
        type: "refund-requested",
        recipientIds: [String(f.ada.id), String(f.alan.id)],
        filter: { refund_request_id: refund.id },
      },
    ]);
  });

  it("refunded: tells the Student their access ended and the Instructor who was Refunded", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    applyRefundDecision(refund.id, "approve", f.ada.id);
    applyRefundDecision(refund.id, "mark_refunded", f.ada.id);
    const notifier = recordingNotifier();

    await notifyRefundDecided(refund.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "refunded",
        recipients: [{ id: String(f.liam.id), name: "Liam" }],
        actor: { id: String(f.ada.id), name: "Ada" },
        data: {
          refund_request_id: refund.id,
          course_title: "Introduction to TypeScript",
          is_team_purchase: false,
          url: "/dashboard",
        },
      },
      {
        operation: "notify",
        type: "purchase-refunded",
        recipients: [{ id: String(f.ivy.id), name: "Ivy" }],
        actor: { id: String(f.ada.id), name: "Ada" },
        data: {
          refund_request_id: refund.id,
          purchase_id: refund.purchaseId,
          course_id: f.course.id,
          course_title: "Introduction to TypeScript",
          student_name: "Liam",
          url: `/instructor/${f.course.id}/students`,
        },
      },
    ]);
  });

  it("refunded on a team Purchase: tells the Student it was a team Purchase", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    const team = testDb.insert(teams).values({}).returning().get();
    testDb
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId: f.course.id,
        code: "SEAT-1",
        purchaseId: refund.purchaseId,
      })
      .run();
    applyRefundDecision(refund.id, "approve", f.ada.id);
    applyRefundDecision(refund.id, "mark_refunded", f.ada.id);
    const notifier = recordingNotifier();

    await notifyRefundDecided(refund.id, notifier);

    expect(notifier.calls[0]).toEqual({
      operation: "notify",
      type: "refunded",
      recipients: [{ id: String(f.liam.id), name: "Liam" }],
      actor: { id: String(f.ada.id), name: "Ada" },
      data: {
        refund_request_id: refund.id,
        course_title: "Introduction to TypeScript",
        is_team_purchase: true,
        url: "/dashboard",
      },
    });
  });

  it("sends the Student nothing when an Admin decides their own Refund Request, but still marks it read", async () => {
    const refund = requestRefund(f.ada.id, f.course.id);
    applyRefundDecision(refund.id, "decline", f.ada.id);
    const notifier = recordingNotifier();

    await notifyRefundDecided(refund.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "markReadWhere",
        type: "refund-requested",
        recipientIds: [String(f.ada.id), String(f.alan.id)],
        filter: { refund_request_id: refund.id },
      },
    ]);
  });

  it("sends nothing for a Refund Request nobody has decided", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    const notifier = recordingNotifier();

    await notifyRefundDecided(refund.id, notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("doesn't throw when the trigger or the mark read fails, and logs both", async () => {
    const refund = requestRefund(f.liam.id, f.course.id);
    applyRefundDecision(refund.id, "approve", f.ada.id);
    const failing = recordingNotifier();
    failing.notify = async () => {
      throw new Error("Knock is down");
    };
    failing.markReadWhere = async () => {
      throw new Error("Knock is down");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyRefundDecided(refund.id, failing)
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(`notify refund-approved to [${f.liam.id}]`),
      expect.any(Error)
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        `markReadWhere refund-requested for [${f.ada.id}, ${f.alan.id}]`
      ),
      expect.any(Error)
    );
    log.mockRestore();
  });
});
