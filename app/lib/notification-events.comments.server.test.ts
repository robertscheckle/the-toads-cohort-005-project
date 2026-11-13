import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "~/test/setup";
import {
  categories,
  comments,
  courses,
  enrollments,
  lessons,
  modules,
  users,
  CourseStatus,
  UserRole,
} from "~/db/schema";
import { recordingNotifier } from "./notifier.server";

// Comment Replied and Comment Posted: the "comment created" event (#30).
// Kept apart from notification-events.server.test.ts so the tickets built in
// parallel on the events module don't edit the same test file.

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { notifyCommentCreated } from "./notification-events.server";

function addUser(name: string, role: UserRole) {
  return testDb
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number) {
  testDb.insert(enrollments).values({ userId, courseId }).run();
}

function seed() {
  const ada = addUser("Ada", UserRole.Admin);
  const ivy = addUser("Ivy", UserRole.Instructor);
  const liam = addUser("Liam", UserRole.Student);
  const mia = addUser("Mia", UserRole.Student);
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
      instructorId: ivy.id,
      categoryId: category.id,
      status: CourseStatus.Published,
      price: 7900,
    })
    .returning()
    .get();
  const module = testDb
    .insert(modules)
    .values({ courseId: course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(lessons)
    .values({ moduleId: module.id, title: "Union Types", position: 1 })
    .returning()
    .get();
  enroll(liam.id, course.id);
  enroll(mia.id, course.id);
  return { ada, ivy, liam, mia, course, lesson };
}

function comment(userId: number, parentId: number | null = null) {
  return testDb
    .insert(comments)
    .values({ userId, lessonId: f.lesson.id, parentId, body: "Hello" })
    .returning()
    .get();
}

let f: ReturnType<typeof seed>;

beforeEach(() => {
  testDb = createTestDb();
  f = seed();
});

describe("notifyCommentCreated: Comment Posted", () => {
  it("sends a top-level comment to the Course's Instructor, with ids, names and a link to the comment", async () => {
    const question = comment(f.liam.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(question.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "comment-posted",
        recipients: [{ id: String(f.ivy.id), name: "Ivy" }],
        actor: { id: String(f.liam.id), name: "Liam" },
        data: {
          comment_id: question.id,
          lesson_id: f.lesson.id,
          course_id: f.course.id,
          commenter_name: "Liam",
          lesson_title: "Union Types",
          course_title: "Introduction to TypeScript",
          url: `/courses/intro-ts/lessons/${f.lesson.id}#comment-${question.id}`,
        },
      },
    ]);
  });

  it("sends nothing for the Instructor's own top-level comment", async () => {
    const own = comment(f.ivy.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(own.id, notifier);

    expect(notifier.calls).toEqual([]);
  });
});

describe("notifyCommentCreated: Comment Replied", () => {
  it("sends a reply to the top-level comment's author, grouped on the top-level comment", async () => {
    const question = comment(f.liam.id);
    const reply = comment(f.mia.id, question.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(reply.id, notifier);

    expect(notifier.calls).toEqual([
      {
        operation: "notify",
        type: "comment-replied",
        recipients: [{ id: String(f.liam.id), name: "Liam" }],
        actor: { id: String(f.mia.id), name: "Mia" },
        data: {
          comment_id: question.id,
          reply_id: reply.id,
          lesson_id: f.lesson.id,
          course_id: f.course.id,
          replier_name: "Mia",
          lesson_title: "Union Types",
          course_title: "Introduction to TypeScript",
          url: `/courses/intro-ts/lessons/${f.lesson.id}#comment-${question.id}`,
        },
      },
    ]);
  });

  it("sends nothing when the top-level comment was deleted", async () => {
    const question = comment(f.liam.id);
    testDb
      .update(comments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(comments.id, question.id))
      .run();
    const reply = comment(f.mia.id, question.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(reply.id, notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("sends nothing when the author is Lapsed and can no longer open the Course", async () => {
    const question = comment(f.liam.id);
    testDb.delete(enrollments).where(eq(enrollments.userId, f.liam.id)).run();
    const reply = comment(f.ivy.id, question.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(reply.id, notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("sends nothing when the author replies in their own thread", async () => {
    const question = comment(f.liam.id);
    const reply = comment(f.liam.id, question.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(reply.id, notifier);

    expect(notifier.calls).toEqual([]);
  });

  it("tells only the top-level author, not others who replied in the thread", async () => {
    const question = comment(f.liam.id);
    comment(f.mia.id, question.id);
    const answer = comment(f.ivy.id, question.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(answer.id, notifier);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]).toMatchObject({
      type: "comment-replied",
      recipients: [{ id: String(f.liam.id), name: "Liam" }],
      actor: { id: String(f.ivy.id), name: "Ivy" },
    });
  });

  it("tells an Admin author, who can open every Course without an Enrollment", async () => {
    const question = comment(f.ada.id);
    const reply = comment(f.liam.id, question.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(reply.id, notifier);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]).toMatchObject({
      type: "comment-replied",
      recipients: [{ id: String(f.ada.id), name: "Ada" }],
      actor: { id: String(f.liam.id), name: "Liam" },
    });
  });

  it("does not send Comment Posted for a reply, even to the Instructor", async () => {
    const question = comment(f.ivy.id);
    const reply = comment(f.liam.id, question.id);
    const notifier = recordingNotifier();

    await notifyCommentCreated(reply.id, notifier);

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]).toMatchObject({
      type: "comment-replied",
      recipients: [{ id: String(f.ivy.id), name: "Ivy" }],
    });
  });
});

describe("notifyCommentCreated: failures", () => {
  it("doesn't throw when the Notifier fails, and logs the type and recipients", async () => {
    const question = comment(f.liam.id);
    const failing = recordingNotifier();
    failing.notify = async () => {
      throw new Error("Knock is down");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyCommentCreated(question.id, failing)
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(`comment-posted to [${f.ivy.id}]`),
      expect.any(Error)
    );
    log.mockRestore();
  });

  it("sends nothing for a comment that doesn't exist", async () => {
    const notifier = recordingNotifier();

    await notifyCommentCreated(999, notifier);

    expect(notifier.calls).toEqual([]);
  });
});
