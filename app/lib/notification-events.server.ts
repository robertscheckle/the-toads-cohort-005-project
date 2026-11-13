import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "~/db";
import {
  comments,
  coupons,
  courseRatings,
  courses,
  enrollments,
  lessons,
  modules,
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
  type UnreadNotification,
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

function getUser(userId: number) {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
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

  const claimer = getUser(seat.claimerId);
  const buyer = getUser(seat.buyerId);
  if (!claimer || !buyer) return;

  const actor = person(claimer);
  const recipients = withoutActor([person(buyer)], actor);
  if (recipients.length === 0) return;

  const seats = countTeamSeats(seat.purchaseId);

  await neverThrow(notifier).notify("team-seat-claimed", recipients, actor, {
    coupon_id: couponId,
    purchase_id: seat.purchaseId,
    claimer_name: claimer.name,
    course_title: seat.courseTitle,
    claimed_seats: seats.claimed,
    total_seats: seats.total,
    url: "/team",
  });
}

/**
 * How many Team Seats Purchase `purchaseId` has, and how many are claimed. A
 * team Purchase is one with Team Seats; a personal Purchase has none.
 */
function countTeamSeats(purchaseId: number): {
  total: number;
  claimed: number;
} {
  const row = db
    .select({ total: count(), claimed: count(coupons.redeemedAt) })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
  return { total: row?.total ?? 0, claimed: row?.claimed ?? 0 };
}

// ─── Comment created: Comment Replied and Comment Posted ───

/** The comment plus everything a comment Notification needs to say and link. */
function getCommentContext(commentId: number) {
  return db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      authorId: users.id,
      authorName: users.name,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(comments.id, commentId))
    .get();
}

type CommentContext = NonNullable<ReturnType<typeof getCommentContext>>;

/** The Lesson, scrolled to comment `commentId` (see comment-thread.tsx). */
function commentUrl(context: CommentContext, commentId: number) {
  return `/courses/${context.courseSlug}/lessons/${context.lessonId}#comment-${commentId}`;
}

/**
 * Whether `user` can open Course `courseId` now: an Admin, its Instructor, or
 * an enrolled Student (a Lapsed Student can't). PPP blocks depend on the
 * viewer's request country, so they're not checked here.
 */
function canOpenCourse(
  user: { id: number; role: UserRole },
  courseId: number,
  instructorId: number
): boolean {
  if (user.role === UserRole.Admin || user.id === instructorId) return true;
  const enrollment = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, user.id), eq(enrollments.courseId, courseId))
    )
    .get();
  return enrollment !== undefined;
}

/** A new top-level comment: tell the Course's Instructor, unless they wrote it. */
async function notifyCommentPosted(
  context: CommentContext,
  notifier: Notifier
): Promise<void> {
  const instructor = getUser(context.instructorId);
  if (!instructor) return;

  const actor = person({ id: context.authorId, name: context.authorName });
  const recipients = withoutActor([person(instructor)], actor);
  if (recipients.length === 0) return;

  await notifier.notify("comment-posted", recipients, actor, {
    comment_id: context.id,
    lesson_id: context.lessonId,
    course_id: context.courseId,
    commenter_name: context.authorName,
    lesson_title: context.lessonTitle,
    course_title: context.courseTitle,
    url: commentUrl(context, context.id),
  });
}

/**
 * A reply: tell the author of the top-level comment, unless they wrote the
 * reply. Others who replied in the thread are not told.
 */
async function notifyCommentReplied(
  reply: CommentContext,
  topLevelId: number,
  notifier: Notifier
): Promise<void> {
  const topLevel = db
    .select({
      authorId: users.id,
      authorName: users.name,
      authorRole: users.role,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.id, topLevelId))
    .get();
  if (!topLevel || topLevel.deletedAt !== null) return;
  if (
    !canOpenCourse(
      { id: topLevel.authorId, role: topLevel.authorRole },
      reply.courseId,
      reply.instructorId
    )
  ) {
    return;
  }

  const actor = person({ id: reply.authorId, name: reply.authorName });
  const author = person({ id: topLevel.authorId, name: topLevel.authorName });
  const recipients = withoutActor([author], actor);
  if (recipients.length === 0) return;

  await notifier.notify("comment-replied", recipients, actor, {
    comment_id: topLevelId,
    reply_id: reply.id,
    lesson_id: reply.lessonId,
    course_id: reply.courseId,
    replier_name: reply.authorName,
    lesson_title: reply.lessonTitle,
    course_title: reply.courseTitle,
    url: commentUrl(reply, topLevelId),
  });
}

/**
 * Comment `commentId` was just created (Lesson page or Instructor questions
 * page, both through createComment). A top-level comment sends Comment Posted;
 * a reply sends Comment Replied.
 */
export async function notifyCommentCreated(
  commentId: number,
  notifier: Notifier = defaultNotifier()
): Promise<void> {
  const context = getCommentContext(commentId);
  if (!context) return;
  const safeNotifier = neverThrow(notifier);

  if (context.parentId === null) {
    await notifyCommentPosted(context, safeNotifier);
    return;
  }

  await notifyCommentReplied(context, context.parentId, safeNotifier);
  await markAnsweredRead(
    context.authorId,
    context.parentId,
    context.lessonId,
    safeNotifier
  );
}

/**
 * "Answering marks it read": `replierId` just replied to top-level comment
 * `topLevelId`, so their own unread Comment Replied / Comment Posted
 * Notifications about it are marked read, in one batch. A Grouped one (Comment
 * Posted groups per Lesson) is marked read only once the replier has replied
 * to every comment in it. Only the recipient's own replies count.
 *
 * Only Notifications that can hold the comment are listed, by the key each
 * type is grouped on: Comment Replied per top-level comment, Comment Posted
 * per Lesson (`lessonId`, the comment's Lesson).
 */
async function markAnsweredRead(
  replierId: number,
  topLevelId: number,
  lessonId: number,
  notifier: Notifier
): Promise<void> {
  const unread = (
    await Promise.all([
      notifier.listUnread("comment-replied", String(replierId), {
        comment_id: topLevelId,
      }),
      notifier.listUnread("comment-posted", String(replierId), {
        lesson_id: lessonId,
      }),
    ])
  ).flat();
  const commentIdsOf = (notification: UnreadNotification) =>
    notification.events.map((event) => Number(event.comment_id));
  const touched = unread.filter((notification) =>
    commentIdsOf(notification).includes(topLevelId)
  );
  if (touched.length === 0) return;

  const answeredIds = commentsRepliedToBy(
    replierId,
    touched.flatMap(commentIdsOf)
  );
  const fullyAnswered = touched.filter((notification) =>
    commentIdsOf(notification).every((id) => answeredIds.has(id))
  );
  if (fullyAnswered.length === 0) return;
  await notifier.markRead(fullyAnswered.map((notification) => notification.id));
}

/** Which of `commentIds` have a (not deleted) reply by `userId`. */
function commentsRepliedToBy(userId: number, commentIds: number[]) {
  const rows = db
    .selectDistinct({ parentId: comments.parentId })
    .from(comments)
    .where(
      and(
        eq(comments.userId, userId),
        inArray(comments.parentId, [...new Set(commentIds)]),
        isNull(comments.deletedAt)
      )
    )
    .all();
  return new Set(rows.map((row) => row.parentId));
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

  const instructor = getUser(purchase.instructorId);
  if (!instructor) return;

  const actor = person({ id: purchase.buyerId, name: purchase.buyerName });
  const recipients = withoutActor([person(instructor)], actor);
  if (recipients.length === 0) return;

  await neverThrow(notifier).notify("course-purchased", recipients, actor, {
    purchase_id: purchaseId,
    course_id: purchase.courseId,
    buyer_name: purchase.buyerName,
    course_title: purchase.courseTitle,
    team_seats: countTeamSeats(purchaseId).total,
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

  const instructor = getUser(rating.instructorId);
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

// ─── Refund decisions ───

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

  const safeNotifier = neverThrow(notifier);
  const actor = person(admin);
  const studentRecipients = withoutActor(
    [person({ id: decided.studentId, name: decided.studentName })],
    actor
  );

  if (decided.status === RefundStatus.Refunded) {
    if (studentRecipients.length > 0) {
      await safeNotifier.notify("refunded", studentRecipients, actor, {
        refund_request_id: refundRequestId,
        course_title: decided.courseTitle,
        is_team_purchase: countTeamSeats(decided.purchaseId).total > 0,
        url: "/dashboard",
      });
    }

    const instructor = getUser(decided.instructorId);
    const instructorRecipients = instructor
      ? withoutActor([person(instructor)], actor)
      : [];
    if (instructorRecipients.length > 0) {
      await safeNotifier.notify(
        "purchase-refunded",
        instructorRecipients,
        actor,
        {
          refund_request_id: refundRequestId,
          purchase_id: decided.purchaseId,
          course_id: decided.courseId,
          course_title: decided.courseTitle,
          student_name: decided.studentName,
          url: `/instructor/${decided.courseId}/students`,
        }
      );
    }
    return;
  }

  if (
    decided.status !== RefundStatus.Approved &&
    decided.status !== RefundStatus.Declined
  ) {
    return;
  }

  if (studentRecipients.length > 0) {
    const type =
      decided.status === RefundStatus.Approved
        ? "refund-approved"
        : "refund-declined";
    await safeNotifier.notify(type, studentRecipients, actor, {
      refund_request_id: refundRequestId,
      course_title: decided.courseTitle,
      url: "/dashboard",
    });
  }

  await safeNotifier.markReadWhere(
    "refund-requested",
    listAdmins().map((a) => String(a.id)),
    { refund_request_id: refundRequestId }
  );
}
