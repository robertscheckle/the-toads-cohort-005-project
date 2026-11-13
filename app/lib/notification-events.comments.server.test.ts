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

describe("notifyCommentCreated: answering marks it read", () => {
  /** The user's unread Notifications: type and the comment id of each event. */
  function unreadOf(
    notifier: ReturnType<typeof recordingNotifier>,
    userId: number
  ) {
    return notifier.messages
      .filter((m) => m.recipientId === String(userId) && !m.read)
      .map((m) => ({
        type: m.type,
        commentIds: m.events.map((e) => e.comment_id),
      }));
  }

  it("marks the Instructor's Comment Posted read when they reply to that comment", async () => {
    const notifier = recordingNotifier();
    const question = comment(f.liam.id);
    await notifyCommentCreated(question.id, notifier);
    expect(unreadOf(notifier, f.ivy.id)).toEqual([
      { type: "comment-posted", commentIds: [question.id] },
    ]);

    const answer = comment(f.ivy.id, question.id);
    await notifyCommentCreated(answer.id, notifier);

    expect(unreadOf(notifier, f.ivy.id)).toEqual([]);
  });

  it("marks the author's Comment Replied read when they reply in that thread, leaving their other Notifications unread", async () => {
    const notifier = recordingNotifier();
    const first = comment(f.liam.id);
    const second = comment(f.liam.id);
    for (const parentId of [first.id, second.id]) {
      const answer = comment(f.ivy.id, parentId);
      await notifyCommentCreated(answer.id, notifier);
    }

    const followUp = comment(f.liam.id, first.id);
    await notifyCommentCreated(followUp.id, notifier);

    expect(unreadOf(notifier, f.liam.id)).toEqual([
      { type: "comment-replied", commentIds: [second.id] },
    ]);
    expect(notifier.calls.filter((c) => c.operation === "markRead")).toEqual([
      { operation: "markRead", notificationIds: [notifier.messages[0].id] },
    ]);
  });

  it("leaves the Instructor's Comment Posted unread when an Admin answers it", async () => {
    const notifier = recordingNotifier();
    const question = comment(f.liam.id);
    await notifyCommentCreated(question.id, notifier);

    const adminAnswer = comment(f.ada.id, question.id);
    await notifyCommentCreated(adminAnswer.id, notifier);

    expect(unreadOf(notifier, f.ivy.id)).toEqual([
      { type: "comment-posted", commentIds: [question.id] },
    ]);
    expect(notifier.calls.map((c) => c.operation)).not.toContain("markRead");
  });

  it("keeps a Grouped Comment Posted unread until the Instructor has replied to every comment in it", async () => {
    const notifier = recordingNotifier(
      {},
      { groupBy: { "comment-posted": "lesson_id" } }
    );
    const liamQuestion = comment(f.liam.id);
    const miaQuestion = comment(f.mia.id);
    await notifyCommentCreated(liamQuestion.id, notifier);
    await notifyCommentCreated(miaQuestion.id, notifier);
    expect(unreadOf(notifier, f.ivy.id)).toEqual([
      { type: "comment-posted", commentIds: [liamQuestion.id, miaQuestion.id] },
    ]);

    // Mia's is the group's latest event; Liam's is still unanswered.
    await notifyCommentCreated(comment(f.ivy.id, miaQuestion.id).id, notifier);
    expect(unreadOf(notifier, f.ivy.id)).toHaveLength(1);

    // Someone else's reply to Liam's doesn't count.
    await notifyCommentCreated(comment(f.ada.id, liamQuestion.id).id, notifier);
    expect(unreadOf(notifier, f.ivy.id)).toHaveLength(1);

    await notifyCommentCreated(comment(f.ivy.id, liamQuestion.id).id, notifier);
    expect(unreadOf(notifier, f.ivy.id)).toEqual([]);
  });

  it("reads the events of only the Notifications about the answered comment or its Lesson", async () => {
    const notifier = recordingNotifier();
    const otherLesson = testDb
      .insert(lessons)
      .values({ moduleId: f.lesson.moduleId, title: "Generics", position: 2 })
      .returning()
      .get();
    const elsewhere = testDb
      .insert(comments)
      .values({ userId: f.liam.id, lessonId: otherLesson.id, body: "Hi" })
      .returning()
      .get();
    const question = comment(f.liam.id);
    await notifyCommentCreated(elsewhere.id, notifier);
    await notifyCommentCreated(question.id, notifier);
    // Ivy also has a Comment Replied about another thread.
    const ivyThread = comment(f.ivy.id);
    await notifyCommentCreated(comment(f.mia.id, ivyThread.id).id, notifier);

    const answer = comment(f.ivy.id, question.id);
    await notifyCommentCreated(answer.id, notifier);

    const aboutQuestion = notifier.messages.find(
      (m) =>
        m.type === "comment-posted" && m.events[0].comment_id === question.id
    );
    expect(notifier.eventReads).toEqual([aboutQuestion?.id]);
    expect(unreadOf(notifier, f.ivy.id)).toEqual([
      { type: "comment-posted", commentIds: [elsewhere.id] },
      { type: "comment-replied", commentIds: [ivyThread.id] },
    ]);
  });

  it("logs a failure to mark read and still sends the Comment Replied", async () => {
    const notifier = recordingNotifier();
    const question = comment(f.liam.id);
    await notifyCommentCreated(question.id, notifier);
    notifier.markRead = async () => {
      throw new Error("Knock is down");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const answer = comment(f.ivy.id, question.id);
    await expect(
      notifyCommentCreated(answer.id, notifier)
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("markRead"),
      expect.any(Error)
    );
    expect(notifier.calls.at(-1)).toMatchObject({
      operation: "notify",
      type: "comment-replied",
      recipients: [{ id: String(f.liam.id), name: "Liam" }],
    });
    log.mockRestore();
  });
});
