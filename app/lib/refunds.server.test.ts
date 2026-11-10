import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "~/test/setup";
import {
  categories,
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  teams,
  users,
  CourseStatus,
  LessonProgressStatus,
  RefundStatus,
  UserRole,
} from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  applyRefundDecision,
  getRefundOffer,
  getTeamSeatBlock,
  listRefundRequests,
} from "./refunds.server";

type Fixture = {
  adminId: number;
  studentId: number;
  courseId: number;
  lessonId: number;
};

function seed(): Fixture {
  const admin = testDb
    .insert(users)
    .values({ name: "Ada", email: "ada@example.com", role: UserRole.Admin })
    .returning()
    .get();
  const instructor = testDb
    .insert(users)
    .values({ name: "Ivy", email: "ivy@example.com", role: UserRole.Instructor })
    .returning()
    .get();
  const student = testDb
    .insert(users)
    .values({ name: "Liam", email: "liam@example.com", role: UserRole.Student })
    .returning()
    .get();
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
      instructorId: instructor.id,
      categoryId: category.id,
      status: CourseStatus.Published,
      price: 7900,
    })
    .returning()
    .get();
  const mod = testDb
    .insert(modules)
    .values({ courseId: course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(lessons)
    .values({ moduleId: mod.id, title: "Hello", position: 1 })
    .returning()
    .get();
  testDb
    .insert(lessons)
    .values({ moduleId: mod.id, title: "World", position: 2 })
    .run();
  testDb
    .insert(lessons)
    .values({ moduleId: mod.id, title: "Again", position: 3 })
    .run();

  return {
    adminId: admin.id,
    studentId: student.id,
    courseId: course.id,
    lessonId: lesson.id,
  };
}

function buy(f: Fixture, createdAt = new Date().toISOString()) {
  const purchase = testDb
    .insert(purchases)
    .values({
      userId: f.studentId,
      courseId: f.courseId,
      amountPaid: 7900,
      createdAt,
    })
    .returning()
    .get();
  testDb
    .insert(enrollments)
    .values({ userId: f.studentId, courseId: f.courseId })
    .run();
  return purchase;
}

function requestRefund(purchaseId: number, status = RefundStatus.Requested) {
  return testDb
    .insert(refunds)
    .values({ purchaseId, status, reason: "Not what I expected." })
    .returning()
    .get();
}

function enrollmentOf(f: Fixture) {
  return testDb
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, f.studentId),
        eq(enrollments.courseId, f.courseId)
      )
    )
    .get();
}

function refundRow(id: number) {
  return testDb.select().from(refunds).where(eq(refunds.id, id)).get()!;
}

describe("applyRefundDecision", () => {
  let f: Fixture;

  beforeEach(() => {
    testDb = createTestDb();
    f = seed();
  });

  it("approves a Requested request, records who decided, and keeps the Enrollment", () => {
    const refund = requestRefund(buy(f).id);
    const now = new Date("2026-11-10T12:00:00Z");

    const result = applyRefundDecision(refund.id, "approve", f.adminId, now);

    expect(result).toMatchObject({ ok: true, status: RefundStatus.Approved });
    expect(result.ok && result.email.subject).toBe(
      "Refund approved: Introduction to TypeScript"
    );
    expect(refundRow(refund.id)).toMatchObject({
      status: RefundStatus.Approved,
      resolvedAt: now.toISOString(),
      resolvedByUserId: f.adminId,
      amountRefunded: null,
    });
    expect(enrollmentOf(f)).toBeDefined();
  });

  it("declines a Requested request and keeps the Enrollment", () => {
    const refund = requestRefund(buy(f).id);

    const result = applyRefundDecision(refund.id, "decline", f.adminId);

    expect(result).toMatchObject({ ok: true, status: RefundStatus.Declined });
    expect(result.ok && result.email.subject).toBe(
      "Refund declined: Introduction to TypeScript"
    );
    expect(refundRow(refund.id).status).toBe(RefundStatus.Declined);
    expect(enrollmentOf(f)).toBeDefined();
  });

  it("marks an Approved request Refunded: full Refund Amount, Enrollment ended, Progress kept", () => {
    const refund = requestRefund(buy(f).id, RefundStatus.Approved);
    testDb
      .insert(lessonProgress)
      .values({
        userId: f.studentId,
        lessonId: f.lessonId,
        status: LessonProgressStatus.Completed,
      })
      .run();

    const result = applyRefundDecision(refund.id, "mark_refunded", f.adminId);

    expect(result).toMatchObject({ ok: true, status: RefundStatus.Refunded });
    expect(result.ok && result.email.body).toContain(
      'Your access to "Introduction to TypeScript" has ended.'
    );
    expect(refundRow(refund.id)).toMatchObject({
      status: RefundStatus.Refunded,
      amountRefunded: 7900,
      resolvedByUserId: f.adminId,
    });
    expect(enrollmentOf(f)).toBeUndefined();
    expect(
      testDb
        .select()
        .from(lessonProgress)
        .where(eq(lessonProgress.userId, f.studentId))
        .all()
    ).toHaveLength(1);
  });

  it("rejects a decision from the wrong status and changes nothing", () => {
    const refund = requestRefund(buy(f).id);

    const result = applyRefundDecision(refund.id, "mark_refunded", f.adminId);

    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(refundRow(refund.id)).toMatchObject({
      status: RefundStatus.Requested,
      resolvedAt: null,
      resolvedByUserId: null,
    });
    expect(enrollmentOf(f)).toBeDefined();
  });

  it("reports a missing request", () => {
    expect(applyRefundDecision(999, "approve", f.adminId)).toMatchObject({
      ok: false,
      httpStatus: 404,
    });
  });

  it("leaves Enrollments alone for a team Purchase and ends its unclaimed Team Seats", () => {
    const purchase = testDb
      .insert(purchases)
      .values({ userId: f.studentId, courseId: f.courseId, amountPaid: 15800 })
      .returning()
      .get();
    const team = testDb.insert(teams).values({}).returning().get();
    testDb
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId: f.courseId,
        code: "SEAT-1",
        purchaseId: purchase.id,
      })
      .run();
    const refund = requestRefund(purchase.id);

    expect(getTeamSeatBlock(purchase.id)).toBe("refund_in_progress");

    applyRefundDecision(refund.id, "approve", f.adminId);
    expect(getTeamSeatBlock(purchase.id)).toBe("refund_in_progress");

    const result = applyRefundDecision(refund.id, "mark_refunded", f.adminId);
    expect(result.ok && result.email.body).toContain(
      "The unclaimed Team Seats from this Purchase are no longer available."
    );
    expect(getTeamSeatBlock(purchase.id)).toBe("refunded");
    expect(refundRow(refund.id).amountRefunded).toBe(15800);
  });

  it("frees Team Seats again when the request is Declined", () => {
    const purchase = testDb
      .insert(purchases)
      .values({ userId: f.studentId, courseId: f.courseId, amountPaid: 15800 })
      .returning()
      .get();
    const refund = requestRefund(purchase.id);

    applyRefundDecision(refund.id, "decline", f.adminId);

    expect(getTeamSeatBlock(purchase.id)).toBeNull();
  });
});

describe("getRefundOffer for a team buyer", () => {
  let f: Fixture;

  beforeEach(() => {
    testDb = createTestDb();
    f = seed();
  });

  it("offers a Refund on unclaimed Team Seats without an Enrollment", () => {
    const purchase = testDb
      .insert(purchases)
      .values({ userId: f.studentId, courseId: f.courseId, amountPaid: 15800 })
      .returning()
      .get();
    const team = testDb.insert(teams).values({}).returning().get();
    testDb
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId: f.courseId,
        code: "SEAT-1",
        purchaseId: purchase.id,
      })
      .run();

    expect(enrollmentOf(f)).toBeUndefined();
    expect(getRefundOffer(f.studentId, f.courseId)).toMatchObject({
      eligible: true,
      refundAmount: 15800,
      isTeamPurchase: true,
    });
  });

  it("marks a Student's own Purchase as not a team Purchase", () => {
    buy(f);
    expect(getRefundOffer(f.studentId, f.courseId)).toMatchObject({
      eligible: true,
      isTeamPurchase: false,
    });
  });
});

describe("buying again after a Refund", () => {
  let f: Fixture;

  beforeEach(() => {
    testDb = createTestDb();
    f = seed();
  });

  it("is never eligible for a second Refund on the same Course", () => {
    const first = buy(f);
    const refund = requestRefund(first.id, RefundStatus.Approved);
    applyRefundDecision(refund.id, "mark_refunded", f.adminId);

    buy(f, new Date(Date.now() + 1000).toISOString());

    expect(getRefundOffer(f.studentId, f.courseId)).toEqual({
      eligible: false,
      reason: "earlier_refund_for_course",
    });
  });
});

describe("listRefundRequests", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("filters by status and includes the Student's Progress", () => {
    const f = seed();
    const purchase = buy(f, "2026-11-01T10:00:00.000Z");
    requestRefund(purchase.id);
    testDb
      .insert(lessonProgress)
      .values({
        userId: f.studentId,
        lessonId: f.lessonId,
        status: LessonProgressStatus.Completed,
      })
      .run();

    const requested = listRefundRequests(RefundStatus.Requested);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      studentName: "Liam",
      courseTitle: "Introduction to TypeScript",
      refundAmount: 7900,
      completedLessonCount: 1,
      totalLessonCount: 3,
      isTeamPurchase: false,
    });

    expect(listRefundRequests(RefundStatus.Approved)).toHaveLength(0);
    expect(listRefundRequests(null)).toHaveLength(1);
  });
});
