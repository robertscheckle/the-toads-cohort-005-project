import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { lessons, modules } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { MAX_COMMENT_LENGTH } from "~/lib/comments";
import { createComment } from "./comments.server";

type Fixture = {
  studentId: number;
  instructorId: number;
  lessonId: number;
  otherLessonId: number;
};

function seed(): Fixture {
  const { user, instructor, course } = seedBaseData(testDb);
  const mod = testDb
    .insert(modules)
    .values({ courseId: course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(lessons)
    .values({ moduleId: mod.id, title: "Hello", position: 1 })
    .returning()
    .get();
  const otherLesson = testDb
    .insert(lessons)
    .values({ moduleId: mod.id, title: "World", position: 2 })
    .returning()
    .get();
  return {
    studentId: user.id,
    instructorId: instructor.id,
    lessonId: lesson.id,
    otherLessonId: otherLesson.id,
  };
}

describe("createComment", () => {
  let f: Fixture;

  beforeEach(() => {
    testDb = createTestDb();
    f = seed();
  });

  it("posts a top-level comment on a Lesson with its body trimmed", () => {
    const comment = createComment({
      userId: f.studentId,
      lessonId: f.lessonId,
      parentId: null,
      body: "  How do generics work?  ",
    });

    expect(comment).toMatchObject({
      userId: f.studentId,
      lessonId: f.lessonId,
      parentId: null,
      body: "How do generics work?",
      deletedAt: null,
    });
  });

  function post(overrides: Partial<Parameters<typeof createComment>[0]> = {}) {
    return createComment({
      userId: f.studentId,
      lessonId: f.lessonId,
      parentId: null,
      body: "How do generics work?",
      ...overrides,
    });
  }

  it("posts a reply to a top-level comment", () => {
    const question = post();

    const reply = post({
      userId: f.instructorId,
      parentId: question.id,
      body: "They let a type take parameters.",
    });

    expect(reply).toMatchObject({
      userId: f.instructorId,
      lessonId: f.lessonId,
      parentId: question.id,
      body: "They let a type take parameters.",
    });
  });

  it("rejects an empty body", () => {
    expect(() => post({ body: "   " })).toThrow("Comment cannot be empty");
  });

  it("rejects a body over the length limit", () => {
    expect(() => post({ body: "a".repeat(MAX_COMMENT_LENGTH + 1) })).toThrow(
      "Comment must be 5000 characters or fewer"
    );
  });

  it("accepts a body exactly at the length limit", () => {
    const comment = post({ body: "a".repeat(MAX_COMMENT_LENGTH) });
    expect(comment.body).toHaveLength(5000);
  });

  it("rejects a Lesson that does not exist", () => {
    expect(() => post({ lessonId: 9999 })).toThrow("Lesson not found");
  });

  it("rejects a reply to a comment that does not exist", () => {
    expect(() => post({ parentId: 9999 })).toThrow("Parent comment not found");
  });

  it("rejects a reply to a comment on a different Lesson", () => {
    const question = post({ lessonId: f.otherLessonId });

    expect(() => post({ parentId: question.id })).toThrow(
      "Parent comment belongs to a different lesson"
    );
  });

  it("rejects a reply to a reply", () => {
    const question = post();
    const reply = post({ parentId: question.id });

    expect(() => post({ parentId: reply.id })).toThrow(
      "Replies can only be one level deep"
    );
  });
});
