// PROTOTYPE — throwaway. Never merge to main.
// Builds the Notifications one user *would* have received, from the real seed
// data, so each person sees only their own context and every link opens.
// Applies the catalog rules (#10) and grouping rules (#15) roughly; it is not
// how the real thing is stored (Knock is the only store, #13).

import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "~/db";
import {
  comments,
  coupons,
  courseRatings,
  courses,
  lessons,
  modules,
  purchases,
  refunds,
  RefundStatus,
  UserRole,
  users,
} from "~/db/schema";
import type {
  NotificationType,
  ProtoNotification,
} from "~/components/notifications-prototype";

interface Event {
  key: string; // the thing a Grouped Notification is about
  type: NotificationType;
  actor: string;
  course: string;
  lesson?: string;
  extra?: string;
  href: string;
  at: number; // ms
  read?: boolean;
  // The recipient has since answered this comment, so it's dealt with.
  answered?: boolean;
}

const MIN = 60_000;
const RETENTION = 90 * 24 * 60 * MIN;
const UNGROUPED: NotificationType[] = [
  "Refund Requested",
  "Refund Approved",
  "Refund Declined",
  "Refunded",
  "Purchase Refunded",
];

// First event is sent at once; later events within the sliding window join a
// Grouped Notification, capped at a maximum span.
function group(events: Event[], now: number): ProtoNotification[] {
  const byKey = new Map<string, Event[]>();
  for (const e of events) {
    const k = `${e.type}:${e.key}`;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const out: ProtoNotification[] = [];
  for (const [k, list] of byKey) {
    list.sort((a, b) => a.at - b.at);
    const isComment = list[0].type.startsWith("Comment");
    const windowMs = (isComment ? 10 : 60) * MIN;
    const maxMs = (isComment ? 60 : 24 * 60) * MIN;
    let open: { events: Event[]; start: number; last: number } | null = null;
    let lastEmittedAt = -Infinity;
    const flush = () => {
      if (!open) return;
      push(open.events);
      lastEmittedAt = open.last;
      open = null;
    };
    const push = (events: Event[]) => {
      const e = events[0];
      const at = events[events.length - 1].at;
      const actors = events.map((x) => x.actor).reverse();
      const answered = events.every((x) => x.answered);
      out.push({
        id: `${k}:${at}`,
        type: e.type,
        actors: [...new Set(actors)],
        course: e.course,
        lesson: e.lesson,
        extra: e.extra,
        href: e.href,
        minutesAgo: Math.max(0, Math.round((now - at) / MIN)),
        read: e.read ?? (answered || now - at > 7 * 24 * 60 * MIN),
        archived: false,
      });
    };
    for (const e of list) {
      if (UNGROUPED.includes(e.type)) {
        push([e]);
        continue;
      }
      if (open && e.at - open.last <= windowMs && e.at - open.start <= maxMs) {
        open.events.push(e);
        open.last = e.at;
      } else {
        flush();
        if (e.at - lastEmittedAt <= windowMs) {
          open = { events: [e], start: e.at, last: e.at };
        } else {
          push([e]);
          lastEmittedAt = e.at;
        }
      }
    }
    flush();
  }
  return out
    .filter((n) => n.minutesAgo * MIN <= RETENTION)
    .sort((a, b) => a.minutesAgo - b.minutesAgo)
    .slice(0, 40);
}

const ms = (iso: string) => new Date(iso).getTime();

function commentEvents(userId: number, ownedCourseIds: number[]): Event[] {
  const authorOf = new Map(
    db
      .select({ id: comments.id, userId: comments.userId })
      .from(comments)
      .all()
      .map((c) => [c.id, c.userId])
  );
  const rows = db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      authorId: comments.userId,
      author: users.name,
      at: comments.createdAt,
      lessonId: lessons.id,
      lesson: lessons.title,
      courseId: courses.id,
      course: courses.title,
      slug: courses.slug,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(ne(comments.userId, userId), isNull(comments.deletedAt)))
    .all()
    .map((r) => ({
      ...r,
      parentAuthor: r.parentId ? authorOf.get(r.parentId) : undefined,
    }));

  // When the recipient replied to each comment (replies are one level deep).
  const myReplies = db
    .select({ parentId: comments.parentId, at: comments.createdAt })
    .from(comments)
    .where(
      and(
        eq(comments.userId, userId),
        isNotNull(comments.parentId),
        isNull(comments.deletedAt)
      )
    )
    .all();
  const answeredAfter = (parentId: number, at: number) =>
    myReplies.some((m) => m.parentId === parentId && ms(m.at) > at);

  const events: Event[] = [];
  for (const r of rows) {
    const base = {
      actor: r.author,
      course: r.course,
      lesson: r.lesson,
      at: ms(r.at),
    };
    if (r.parentId && r.parentAuthor === userId) {
      events.push({
        ...base,
        key: `c${r.parentId}`,
        type: "Comment Replied",
        href: `/courses/${r.slug}/lessons/${r.lessonId}#comment-${r.parentId}`,
        answered: answeredAfter(r.parentId, base.at),
      });
    } else if (!r.parentId && ownedCourseIds.includes(r.courseId)) {
      events.push({
        ...base,
        key: `l${r.lessonId}`,
        type: "Comment Posted",
        href: `/courses/${r.slug}/lessons/${r.lessonId}#comment-${r.id}`,
        answered: answeredAfter(r.id, base.at),
      });
    }
  }
  return events;
}

function studentEvents(userId: number): Event[] {
  const events: Event[] = [];
  const myRefunds = db
    .select({
      id: refunds.id,
      status: refunds.status,
      amount: refunds.amountRefunded,
      resolvedAt: refunds.resolvedAt,
      course: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(eq(purchases.userId, userId), isNotNull(refunds.resolvedAt)))
    .all();
  for (const r of myRefunds) {
    const type: NotificationType | null =
      r.status === RefundStatus.Approved
        ? "Refund Approved"
        : r.status === RefundStatus.Declined
          ? "Refund Declined"
          : r.status === RefundStatus.Refunded
            ? "Refunded"
            : null;
    if (!type) continue;
    events.push({
      key: `r${r.id}`,
      type,
      actor: "",
      course: r.course,
      extra: r.amount !== null ? `$${(r.amount / 100).toFixed(2)}` : undefined,
      href: "/dashboard",
      at: ms(r.resolvedAt!),
    });
  }

  const claimed = db
    .select({
      purchaseId: purchases.id,
      who: users.name,
      at: coupons.redeemedAt,
      course: courses.title,
    })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(coupons.redeemedByUserId, users.id))
    .where(
      and(eq(purchases.userId, userId), ne(coupons.redeemedByUserId, userId))
    )
    .all();
  for (const c of claimed) {
    events.push({
      key: `p${c.purchaseId}`,
      type: "Team Seat Claimed",
      actor: c.who,
      course: c.course,
      href: "/team",
      at: ms(c.at!),
    });
  }
  return events;
}

function instructorEvents(userId: number, ownedCourseIds: number[]): Event[] {
  if (ownedCourseIds.length === 0) return [];
  const events: Event[] = [];
  const bought = db
    .select({
      id: purchases.id,
      courseId: courses.id,
      course: courses.title,
      who: users.name,
      at: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(
      and(
        inArray(purchases.courseId, ownedCourseIds),
        ne(purchases.userId, userId)
      )
    )
    .all();
  const seats = new Map<number, number>();
  for (const c of db
    .select({ purchaseId: coupons.purchaseId })
    .from(coupons)
    .all())
    seats.set(c.purchaseId, (seats.get(c.purchaseId) ?? 0) + 1);
  for (const p of bought) {
    const n = seats.get(p.id);
    events.push({
      key: `c${p.courseId}`,
      type: "Course Purchased",
      actor: p.who,
      course: p.course,
      extra: n ? `${n} Team Seats` : undefined,
      href: `/instructor/${p.courseId}/students`,
      at: ms(p.at),
    });
  }

  const refunded = db
    .select({
      id: refunds.id,
      courseId: courses.id,
      course: courses.title,
      who: users.name,
      at: refunds.resolvedAt,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(
      and(
        inArray(purchases.courseId, ownedCourseIds),
        eq(refunds.status, RefundStatus.Refunded)
      )
    )
    .all();
  for (const r of refunded)
    events.push({
      key: `r${r.id}`,
      type: "Purchase Refunded",
      actor: r.who,
      course: r.course,
      href: `/instructor/${r.courseId}/students`,
      at: ms(r.at!),
    });

  const rated = db
    .select({
      courseId: courses.id,
      course: courses.title,
      who: users.name,
      rating: courseRatings.rating,
      at: courseRatings.createdAt,
    })
    .from(courseRatings)
    .innerJoin(courses, eq(courseRatings.courseId, courses.id))
    .innerJoin(users, eq(courseRatings.userId, users.id))
    .where(inArray(courseRatings.courseId, ownedCourseIds))
    .all();
  for (const r of rated)
    events.push({
      key: `c${r.courseId}`,
      type: "Course Rated",
      actor: r.who,
      course: r.course,
      extra: `${"★".repeat(r.rating)}`,
      href: `/instructor/${r.courseId}`,
      at: ms(r.at),
    });
  return events;
}

function adminEvents(userId: number): Event[] {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      who: users.name,
      whoId: users.id,
      at: refunds.requestedAt,
      course: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .all()
    .filter((r) => r.whoId !== userId)
    .map((r) => ({
      key: `r${r.id}`,
      type: "Refund Requested" as const,
      actor: r.who,
      course: r.course,
      href: "/admin/refunds",
      at: ms(r.at),
      // Decided by any Admin → read for every Admin (#12)
      read: r.status !== RefundStatus.Requested,
    }));
}

export function buildPrototypeNotifications(
  userId: number,
  role: UserRole
): ProtoNotification[] {
  const owned =
    role === UserRole.Instructor
      ? db
          .select({ id: courses.id })
          .from(courses)
          .where(eq(courses.instructorId, userId))
          .all()
          .map((c) => c.id)
      : [];
  const events = [
    ...commentEvents(userId, owned),
    ...(role === UserRole.Student ? studentEvents(userId) : []),
    ...(role === UserRole.Instructor ? instructorEvents(userId, owned) : []),
    ...(role === UserRole.Admin ? adminEvents(userId) : []),
  ];
  return group(events, Date.now());
}
