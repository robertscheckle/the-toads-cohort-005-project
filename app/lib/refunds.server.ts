import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  users,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";
import {
  buildRefundApprovedEmail,
  buildRefundDeclinedEmail,
  buildRefundedEmail,
  decideRefundEligibility,
  decideRefundTransition,
  decideTeamSeatBlock,
  daysLeftInRefundWindow,
  lastDayOfRefundWindow,
  type RefundDecision,
  type RefundEmail,
  type RefundIneligibleReason,
  type TeamSeatBlock,
} from "~/lib/refunds";

type Purchase = typeof purchases.$inferSelect;

export type RefundOffer =
  | {
      eligible: true;
      purchase: Purchase;
      refundAmount: number;
      lastDayInWindow: string;
      /** A Purchase of Team Seats rather than the Student's own Enrollment. */
      isTeamPurchase: boolean;
    }
  | { eligible: false; reason: RefundIneligibleReason | "no_purchase" };

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function hasEarlierRefundRequest(purchaseId: number) {
  return !!db
    .select({ id: refunds.id })
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .get();
}

function hasEarlierRefundForCourse(userId: number, courseId: number) {
  return !!db
    .select({ id: refunds.id })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        eq(refunds.status, RefundStatus.Refunded)
      )
    )
    .get();
}

// A seat that came out of a team purchase, and has been claimed, belongs to the
// team — the Student cannot hand it back on their own.
function hasClaimedSeat(purchaseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt)))
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

// Watched time is the furthest point reached in each lesson, summed.
function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

/**
 * Whether this Student's latest Purchase of the course may receive a Refund
 * Request, and if so for what Refund Amount. The course page and the refund
 * action both ask here, so they can never disagree.
 */
export function getRefundOffer(
  userId: number,
  courseId: number,
  today: Date = new Date()
): RefundOffer {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return { eligible: false, reason: "no_purchase" };

  const lessonIds = getLessonIdsForCourse(courseId);

  const eligibility = decideRefundEligibility({
    purchasedAt: new Date(purchase.createdAt),
    today,
    hasEarlierRefundRequest: hasEarlierRefundRequest(purchase.id),
    hasEarlierRefundForCourse: hasEarlierRefundForCourse(userId, courseId),
    hasClaimedSeat: hasClaimedSeat(purchase.id),
    completedLessonCount: getCompletedLessonCount(userId, lessonIds),
    totalLessonCount: lessonIds.length,
    secondsWatched: getSecondsWatched(userId, lessonIds),
  });

  if (!eligibility.eligible) return eligibility;

  return {
    eligible: true,
    purchase,
    // The Refund Amount is always what the Student actually paid.
    refundAmount: purchase.amountPaid,
    lastDayInWindow: eligibility.lastDayInWindow,
    isTeamPurchase: isTeamPurchase(purchase.id),
  };
}

// ─── Team Seats ───

function isTeamPurchase(purchaseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
}

/**
 * Why an unclaimed Team Seat from this Purchase cannot be claimed right now, or
 * null when it can.
 */
export function getTeamSeatBlock(purchaseId: number): TeamSeatBlock | null {
  const refund = db
    .select({ status: refunds.status })
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .get();

  return decideTeamSeatBlock(refund?.status ?? null);
}

// ─── Admin refund review ───

export type RefundReviewRow = {
  id: number;
  status: RefundStatus;
  reason: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  refundAmount: number;
  amountRefunded: number | null;
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  courseSlug: string;
  purchasedAt: string;
  lastDayInWindow: string;
  daysLeftInWindow: number;
  isTeamPurchase: boolean;
  completedLessonCount: number;
  totalLessonCount: number;
  secondsWatched: number;
};

/**
 * Refund Requests for the Admin review page, oldest first, with the Progress an
 * Admin needs to judge each one.
 */
export function listRefundRequests(
  status: RefundStatus | null,
  today: Date = new Date()
): RefundReviewRow[] {
  const rows = db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      resolvedByUserId: refunds.resolvedByUserId,
      amountRefunded: refunds.amountRefunded,
      purchaseId: purchases.id,
      refundAmount: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      studentId: users.id,
      studentName: users.name,
      studentEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(status ? eq(refunds.status, status) : undefined)
    .orderBy(refunds.requestedAt)
    .all();

  const lessonIdsByCourse = new Map<number, number[]>();

  return rows.map((row) => {
    let lessonIds = lessonIdsByCourse.get(row.courseId);
    if (!lessonIds) {
      lessonIds = getLessonIdsForCourse(row.courseId);
      lessonIdsByCourse.set(row.courseId, lessonIds);
    }

    const resolvedBy = row.resolvedByUserId
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, row.resolvedByUserId))
          .get()
      : undefined;

    return {
      id: row.id,
      status: row.status,
      reason: row.reason,
      requestedAt: row.requestedAt,
      resolvedAt: row.resolvedAt,
      resolvedByName: resolvedBy?.name ?? null,
      refundAmount: row.refundAmount,
      amountRefunded: row.amountRefunded,
      studentName: row.studentName,
      studentEmail: row.studentEmail,
      courseTitle: row.courseTitle,
      courseSlug: row.courseSlug,
      purchasedAt: row.purchasedAt,
      lastDayInWindow: lastDayOfRefundWindow(new Date(row.purchasedAt)),
      daysLeftInWindow: daysLeftInRefundWindow(new Date(row.purchasedAt), today),
      isTeamPurchase: isTeamPurchase(row.purchaseId),
      completedLessonCount: getCompletedLessonCount(row.studentId, lessonIds),
      totalLessonCount: lessonIds.length,
      secondsWatched: getSecondsWatched(row.studentId, lessonIds),
    };
  });
}

export type RefundDecisionResult =
  | { ok: true; status: RefundStatus; email: RefundEmail }
  | { ok: false; httpStatus: 404 | 409; message: string };

/**
 * Applies an Admin's decision to a Refund Request: moves its status, records
 * who decided and when, and at Refunded ends the Student's Enrollment (see
 * docs/adr/0001-refunded-deletes-the-enrollment.md). Progress is left alone.
 * Returns the email to send; the caller sends it.
 */
export function applyRefundDecision(
  refundId: number,
  decision: RefundDecision,
  adminUserId: number,
  now: Date = new Date()
): RefundDecisionResult {
  return db.transaction((tx) => {
    const row = tx
      .select({
        status: refunds.status,
        purchaseId: purchases.id,
        studentId: purchases.userId,
        courseId: purchases.courseId,
        refundAmount: purchases.amountPaid,
        studentName: users.name,
        studentEmail: users.email,
        courseTitle: courses.title,
      })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .innerJoin(users, eq(purchases.userId, users.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(eq(refunds.id, refundId))
      .get();

    if (!row) {
      return {
        ok: false as const,
        httpStatus: 404 as const,
        message: "Refund request not found.",
      };
    }

    const transition = decideRefundTransition(row.status, decision);
    if (!transition.ok) {
      return {
        ok: false as const,
        httpStatus: 409 as const,
        message: transition.message,
      };
    }

    const isRefunded = transition.next === RefundStatus.Refunded;

    tx.update(refunds)
      .set({
        status: transition.next,
        resolvedAt: now.toISOString(),
        resolvedByUserId: adminUserId,
        // No partial Refunds: always the full Refund Amount.
        ...(isRefunded ? { amountRefunded: row.refundAmount } : {}),
      })
      .where(and(eq(refunds.id, refundId), eq(refunds.status, row.status)))
      .run();

    const teamPurchase = isTeamPurchase(row.purchaseId);

    // A team Purchase gives the buyer no Enrollment; its unclaimed Team Seats
    // stop being available through getTeamSeatBlock instead.
    if (isRefunded && !teamPurchase) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, row.studentId),
            eq(enrollments.courseId, row.courseId)
          )
        )
        .run();
    }

    const student = {
      studentName: row.studentName,
      studentEmail: row.studentEmail,
      courseTitle: row.courseTitle,
    };

    const email =
      decision === "approve"
        ? buildRefundApprovedEmail({ ...student, refundAmount: row.refundAmount })
        : decision === "decline"
          ? buildRefundDeclinedEmail(student)
          : buildRefundedEmail({
              ...student,
              refundAmount: row.refundAmount,
              isTeamPurchase: teamPurchase,
            });

    return { ok: true as const, status: transition.next, email };
  });
}
