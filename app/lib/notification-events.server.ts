import { and, asc, count, eq, isNotNull, type SQL } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  purchases,
  refunds,
  users,
  UserRole,
} from "~/db/schema";
import {
  defaultNotifier,
  neverThrow,
  type NotificationPerson,
  type Notifier,
} from "~/lib/notifier.server";

// ─── Notification events ───
// One function per catalog event (plus read-state follow-ups). Route actions
// call these inline right after their database write and pass only ids. Each
// function looks up recipients and display data, applies the recipient rules
// (nobody is notified about their own action; nobody about something they
// can't open), builds the trigger data, and calls the Notifier.
//
// None of these throw because of the Notifier: it is always wrapped in
// neverThrow().
//
// Uses positional parameters (project convention).

function person(user: { id: number; name: string }): NotificationPerson {
  return { id: String(user.id), name: user.name };
}

/** Removes the actor from the recipients: no Notification for your own action. */
function withoutActor(
  recipients: NotificationPerson[],
  actor: NotificationPerson
): NotificationPerson[] {
  return recipients.filter((recipient) => recipient.id !== actor.id);
}

function listAdmins() {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .orderBy(asc(users.id))
    .all();
}

// ─── Refund Requested ───

/** A Student made Refund Request `refundRequestId`: tell every Admin. */
export async function notifyRefundRequested(
  refundRequestId: number,
  notifier: Notifier = defaultNotifier()
): Promise<void> {
  const request = db
    .select({
      studentId: users.id,
      studentName: users.name,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
    .innerJoin(users, eq(users.id, purchases.userId))
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(eq(refunds.id, refundRequestId))
    .get();
  if (!request) return;

  const actor = person({ id: request.studentId, name: request.studentName });
  const recipients = withoutActor(listAdmins().map(person), actor);
  if (recipients.length === 0) return;

  await neverThrow(notifier).notify("refund-requested", recipients, actor, {
    refund_request_id: refundRequestId,
    student_name: request.studentName,
    course_title: request.courseTitle,
    url: "/admin/refunds",
  });
}

// ─── Team Seat Claimed ───

/**
 * Team Seat `couponId` was just claimed: tell the Student who made that team
 * Purchase, with how many of its Team Seats are now claimed. Nothing goes to
 * the Instructor, and nothing when the buyer claims their own seat.
 */
export async function notifyTeamSeatClaimed(
  couponId: number,
  notifier: Notifier = defaultNotifier()
): Promise<void> {
  const seat = db
    .select({
      purchaseId: coupons.purchaseId,
      claimerId: coupons.redeemedByUserId,
      buyerId: purchases.userId,
      courseTitle: courses.title,
    })
    .from(coupons)
    .innerJoin(purchases, eq(purchases.id, coupons.purchaseId))
    .innerJoin(courses, eq(courses.id, coupons.courseId))
    .where(eq(coupons.id, couponId))
    .get();
  if (!seat || seat.claimerId === null) return;

  const claimer = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, seat.claimerId))
    .get();
  const buyer = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, seat.buyerId))
    .get();
  if (!claimer || !buyer) return;

  const actor = person(claimer);
  const recipients = withoutActor([person(buyer)], actor);
  if (recipients.length === 0) return;

  const totalSeats = countSeats(eq(coupons.purchaseId, seat.purchaseId));
  const claimedSeats = countSeats(
    and(eq(coupons.purchaseId, seat.purchaseId), isNotNull(coupons.redeemedAt))
  );

  await neverThrow(notifier).notify("team-seat-claimed", recipients, actor, {
    coupon_id: couponId,
    purchase_id: seat.purchaseId,
    claimer_name: claimer.name,
    course_title: seat.courseTitle,
    claimed_seats: claimedSeats,
    total_seats: totalSeats,
    url: "/team",
  });
}

function countSeats(where: SQL | undefined): number {
  const row = db.select({ seats: count() }).from(coupons).where(where).get();
  return row?.seats ?? 0;
}
