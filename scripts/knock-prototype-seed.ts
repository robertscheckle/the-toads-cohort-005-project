// PROTOTYPE — throwaway. Never merge to main. (#24)
// Sends the seed data's events into Knock Development, in time order, so the
// Notifications page has a real feed to read.
//
//   npx tsx scripts/knock-prototype-seed.ts          # send
//   npx tsx scripts/knock-prototype-seed.ts --dry    # count only
//
// Knock stamps each message with the time it was triggered, so everything
// arrives as "just now": the seed's history can't be back-dated. Events with
// the same batch key land in one batch window, so expect a first item at once
// and a Grouped Notification after the window closes (10 min for comments,
// 1 h for purchases).

import Database from "better-sqlite3";
import {
  triggerCommentReplied,
  triggerCoursePurchased,
  triggerRefundRequested,
} from "../app/lib/knock-prototype.server";

process.loadEnvFile(".env");
const dry = process.argv.includes("--dry");
const db = new Database("data.db", { readonly: true });

type Ev = { at: string; send: () => Promise<unknown>; label: string };
const events: Ev[] = [];

const replies = db
  .prepare(
    `select r.created_at at, p.id commentId, a.id recipientId, a.name recipientName,
            u.id replierId, u.name replierName, l.id lessonId, l.title lessonTitle,
            c.title courseTitle, c.slug slug
       from comments r
       join comments p on r.parent_id = p.id
       join users a on p.user_id = a.id
       join users u on r.user_id = u.id
       join lessons l on r.lesson_id = l.id
       join modules m on l.module_id = m.id
       join courses c on m.course_id = c.id
      where r.user_id <> p.user_id and r.deleted_at is null and p.parent_id is null`
  )
  .all() as any[];
for (const r of replies)
  events.push({
    at: r.at,
    label: `comment-replied → ${r.recipientName} (comment ${r.commentId})`,
    send: () =>
      triggerCommentReplied({
        recipient: { id: r.recipientId, name: r.recipientName },
        replier: { id: r.replierId, name: r.replierName },
        commentId: r.commentId,
        lessonTitle: r.lessonTitle,
        courseTitle: r.courseTitle,
        url: `/courses/${r.slug}/lessons/${r.lessonId}#comment-${r.commentId}`,
      }),
  });

const purchases = db
  .prepare(
    `select p.created_at at, c.id courseId, c.title courseTitle,
            i.id instructorId, i.name instructorName, b.id buyerId, b.name buyerName
       from purchases p
       join courses c on p.course_id = c.id
       join users i on c.instructor_id = i.id
       join users b on p.user_id = b.id
      where b.id <> i.id`
  )
  .all() as any[];
for (const p of purchases)
  events.push({
    at: p.at,
    label: `course-purchased → ${p.instructorName} (course ${p.courseId})`,
    send: () =>
      triggerCoursePurchased({
        instructor: { id: p.instructorId, name: p.instructorName },
        buyer: { id: p.buyerId, name: p.buyerName },
        courseId: p.courseId,
        courseTitle: p.courseTitle,
      }),
  });

const admins = db
  .prepare(`select id, name from users where role = 'admin'`)
  .all() as { id: number; name: string }[];
const refunds = db
  .prepare(
    `select r.id, r.requested_at at, s.id studentId, s.name studentName, c.title courseTitle
       from refunds r
       join purchases p on r.purchase_id = p.id
       join users s on p.user_id = s.id
       join courses c on p.course_id = c.id`
  )
  .all() as any[];
for (const r of refunds)
  events.push({
    at: r.at,
    label: `refund-requested → ${admins.length} Admin(s) (refund ${r.id})`,
    send: () =>
      triggerRefundRequested({
        admins,
        student: { id: r.studentId, name: r.studentName },
        refundRequestId: r.id,
        courseTitle: r.courseTitle,
      }),
  });

events.sort((a, b) => a.at.localeCompare(b.at));
console.log(
  `${events.length} events: ${replies.length} replies, ${purchases.length} purchases, ${refunds.length} refunds`
);
if (!dry) {
  let failed = 0;
  for (const e of events) {
    try {
      await e.send();
      console.log("sent", e.label);
    } catch (err) {
      failed++;
      console.error("FAILED", e.label, (err as Error).message);
    }
  }
  console.log(`done, ${failed} failed`);
}
