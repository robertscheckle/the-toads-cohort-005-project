import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
} from "~/db/schema";
import {
  decideRefundEligibility,
  type RefundIneligibleReason,
} from "~/lib/refunds";

type Purchase = typeof purchases.$inferSelect;

export type RefundOffer =
  | {
      eligible: true;
      purchase: Purchase;
      refundAmount: number;
      lastDayInWindow: string;
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
  };
}
