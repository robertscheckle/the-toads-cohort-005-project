import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  comments,
  courses,
  enrollments,
  lessons,
  modules,
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
  const instructor = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, context.instructorId))
    .get();
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
  // "Answering marks it read" (#31) goes here: the replier
  // (context.authorId) answered top-level comment context.parentId.
}
