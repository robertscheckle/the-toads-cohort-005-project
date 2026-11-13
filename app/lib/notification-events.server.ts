import { asc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  purchases,
  refunds,
  users,
  RefundStatus,
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

// ─── Refund decisions ───

function getUser(userId: number) {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/**
 * An Admin decided Refund Request `refundRequestId`; call right after the
 * decision is written. Reads the outcome from the Refund Request:
 * - Approved / Declined: tells the Student, and marks that Refund Requested
 *   Notification read for every Admin.
 * - Refunded: tells the Student (Team Seat wording for a team Purchase) and
 *   the Course's Instructor.
 */
export async function notifyRefundDecided(
  refundRequestId: number,
  notifier: Notifier = defaultNotifier()
): Promise<void> {
  const decided = db
    .select({
      status: refunds.status,
      adminId: refunds.resolvedByUserId,
      purchaseId: purchases.id,
      studentId: users.id,
      studentName: users.name,
      courseId: courses.id,
      courseTitle: courses.title,
      instructorId: courses.instructorId,
    })
    .from(refunds)
    .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
    .innerJoin(users, eq(users.id, purchases.userId))
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(eq(refunds.id, refundRequestId))
    .get();
  if (!decided || decided.adminId === null) return;

  const admin = getUser(decided.adminId);
  if (!admin) return;

  const safe = neverThrow(notifier);
  const actor = person(admin);
  const student = withoutActor(
    [person({ id: decided.studentId, name: decided.studentName })],
    actor
  );

  if (decided.status === RefundStatus.Refunded) {
    if (student.length > 0) {
      const isTeamPurchase = !!db
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(coupons.purchaseId, decided.purchaseId))
        .get();
      await safe.notify("refunded", student, actor, {
        refund_request_id: refundRequestId,
        course_title: decided.courseTitle,
        is_team_purchase: isTeamPurchase,
        url: "/dashboard",
      });
    }

    const instructor = getUser(decided.instructorId);
    const instructors = instructor
      ? withoutActor([person(instructor)], actor)
      : [];
    if (instructors.length > 0) {
      await safe.notify("purchase-refunded", instructors, actor, {
        refund_request_id: refundRequestId,
        purchase_id: decided.purchaseId,
        course_id: decided.courseId,
        course_title: decided.courseTitle,
        student_name: decided.studentName,
        url: `/instructor/${decided.courseId}/students`,
      });
    }
    return;
  }

  if (
    decided.status !== RefundStatus.Approved &&
    decided.status !== RefundStatus.Declined
  ) {
    return;
  }

  if (student.length > 0) {
    const type =
      decided.status === RefundStatus.Approved
        ? "refund-approved"
        : "refund-declined";
    await safe.notify(type, student, actor, {
      refund_request_id: refundRequestId,
      course_title: decided.courseTitle,
      url: "/dashboard",
    });
  }

  await safe.markReadWhere(
    "refund-requested",
    listAdmins().map((a) => String(a.id)),
    { refund_request_id: refundRequestId }
  );
}
