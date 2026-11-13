import { asc, count, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courseRatings,
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

// ─── Course Purchased ───

/**
 * A Student made Purchase `purchaseId` (for themselves or for Team Seats):
 * tell the Instructor who owns the Course. Claiming a Team Seat later is not a
 * Purchase and sends the Instructor nothing.
 */
export async function notifyCoursePurchased(
  purchaseId: number,
  notifier: Notifier = defaultNotifier()
): Promise<void> {
  const purchase = db
    .select({
      buyerId: users.id,
      buyerName: users.name,
      courseId: courses.id,
      courseTitle: courses.title,
      instructorId: courses.instructorId,
    })
    .from(purchases)
    .innerJoin(users, eq(users.id, purchases.userId))
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(eq(purchases.id, purchaseId))
    .get();
  if (!purchase) return;

  const instructor = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, purchase.instructorId))
    .get();
  if (!instructor) return;

  // A team Purchase is one with Team Seats; a personal Purchase has none.
  const teamSeats =
    db
      .select({ seats: count() })
      .from(coupons)
      .where(eq(coupons.purchaseId, purchaseId))
      .get()?.seats ?? 0;

  const actor = person({ id: purchase.buyerId, name: purchase.buyerName });
  const recipients = withoutActor([person(instructor)], actor);
  if (recipients.length === 0) return;

  await neverThrow(notifier).notify("course-purchased", recipients, actor, {
    purchase_id: purchaseId,
    course_id: purchase.courseId,
    buyer_name: purchase.buyerName,
    course_title: purchase.courseTitle,
    team_seats: teamSeats,
    url: `/instructor/${purchase.courseId}/students`,
  });
}

// ─── Course Rated ───

/** Whether a rating write created the Student's rating or changed an existing one. */
export type CourseRatingChange = "first" | "edit";

/**
 * A Student rated a Course (Course Rating `courseRatingId`): tell the
 * Instructor who owns it, but only for a first rating, never for an edit.
 */
export async function notifyCourseRated(
  courseRatingId: number,
  change: CourseRatingChange,
  notifier: Notifier = defaultNotifier()
): Promise<void> {
  if (change === "edit") return;

  const rating = db
    .select({
      rating: courseRatings.rating,
      studentId: users.id,
      studentName: users.name,
      courseId: courses.id,
      courseTitle: courses.title,
      instructorId: courses.instructorId,
    })
    .from(courseRatings)
    .innerJoin(users, eq(users.id, courseRatings.userId))
    .innerJoin(courses, eq(courses.id, courseRatings.courseId))
    .where(eq(courseRatings.id, courseRatingId))
    .get();
  if (!rating) return;

  const instructor = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, rating.instructorId))
    .get();
  if (!instructor) return;

  const actor = person({ id: rating.studentId, name: rating.studentName });
  const recipients = withoutActor([person(instructor)], actor);
  if (recipients.length === 0) return;

  await neverThrow(notifier).notify("course-rated", recipients, actor, {
    course_rating_id: courseRatingId,
    course_id: rating.courseId,
    course_title: rating.courseTitle,
    student_name: rating.studentName,
    rating: rating.rating,
    url: `/instructor/${rating.courseId}`,
  });
}
