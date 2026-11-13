import { eq } from "drizzle-orm";
import { db } from "~/db";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";

/**
 * Trims a comment body and checks its length. Throws a user-facing Error when
 * the body is empty or too long.
 */
export function assertValidCommentBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

export function getCommentById(commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

/** The Course a Lesson belongs to: its id and Instructor. */
export function getCourseForLesson(lessonId: number) {
  return db
    .select({ courseId: courses.id, instructorId: courses.instructorId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

export type CreateCommentInput = {
  userId: number;
  lessonId: number;
  /** Null for a top-level comment; otherwise the top-level comment replied to. */
  parentId: number | null;
  body: string;
};

/**
 * The one place comments are created, from a Lesson page or the Instructor
 * questions page. Callers check access first; this validates the body and the
 * reply target, then inserts. Validation failures throw a user-facing Error.
 */
export function createComment({
  userId,
  lessonId,
  parentId,
  body,
}: CreateCommentInput) {
  const trimmed = assertValidCommentBody(body);

  const course = getCourseForLesson(lessonId);
  if (!course) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = getCommentById(parentId);
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  return db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();
}
