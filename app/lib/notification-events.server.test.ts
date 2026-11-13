import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "~/test/setup";
import {
  categories,
  coupons,
  courses,
  enrollments,
  purchases,
  refunds,
  teams,
  users,
  CourseStatus,
  RefundStatus,
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
} from "./notification-events.server";
import { applyRefundDecision } from "./refunds.server";

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
