// PROTOTYPE — throwaway (#24). Never merge to main.
// Triggers a real Knock workflow with the current user as recipient, so live
// arrival can be judged in one browser.
//   one   → by role: Student comment-replied, Instructor course-purchased,
//           Admin refund-requested
//   burst → three comment-replied events on one comment from three people,
//           to watch the batch step build a Grouped Notification (10 min)

import { and, eq, isNull, ne } from "drizzle-orm";
import type { Route } from "./+types/api.prototype-knock";
import { db } from "~/db";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  triggerCommentReplied,
  triggerCoursePurchased,
  triggerRefundRequested,
} from "~/lib/knock-prototype.server";

function someComment(userId: number) {
  const q = () =>
    db
      .select({
        id: comments.id,
        lessonId: lessons.id,
        lesson: lessons.title,
        course: courses.title,
        slug: courses.slug,
      })
      .from(comments)
      .innerJoin(lessons, eq(comments.lessonId, lessons.id))
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id));
  // Prefer the user's own top-level comment so the link makes sense.
  return (
    q()
      .where(and(eq(comments.userId, userId), isNull(comments.parentId)))
      .get() ?? q().where(isNull(comments.parentId)).get()!
  );
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) return { ok: false };
  const me = db.select().from(users).where(eq(users.id, userId)).get()!;
  const others = db
    .select()
    .from(users)
    .where(ne(users.id, userId))
    .all()
    .sort(() => Math.random() - 0.5);
  const intent = (await request.formData()).get("intent");

  const reply = (from: (typeof others)[number]) => {
    const c = someComment(userId);
    return triggerCommentReplied({
      recipient: me,
      replier: from,
      commentId: c.id,
      lessonTitle: c.lesson,
      courseTitle: c.course,
      url: `/courses/${c.slug}/lessons/${c.lessonId}#comment-${c.id}`,
    });
  };

  if (intent === "burst") {
    for (const from of others.slice(0, 3)) await reply(from);
  } else if (me.role === UserRole.Instructor) {
    const course = db
      .select()
      .from(courses)
      .where(eq(courses.instructorId, userId))
      .get()!;
    await triggerCoursePurchased({
      instructor: me,
      buyer: others[0],
      courseId: course.id,
      courseTitle: course.title,
    });
  } else if (me.role === UserRole.Admin) {
    await triggerRefundRequested({
      admins: [me],
      student: others[0],
      refundRequestId: Date.now(),
      courseTitle: "Prototype Course",
    });
  } else {
    await reply(others[0]);
  }
  console.log(
    `[knock-prototype] sent ${intent} for user ${userId} at ${new Date().toISOString()}`
  );
  return { ok: true };
}
