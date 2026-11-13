// PROTOTYPE — throwaway. Wayfinder ticket "Prototype the Notifications page
// against the real Knock feed" (#24). Never merge to main.
//
// Only the three workflows committed in Knock Development (#23) exist:
// comment-replied, course-purchased and refund-requested. Knock user ids are
// Cadence user ids as strings. Actors and recipients are passed inline as
// { id, name } so Knock knows their names without a separate identify call.

import { Knock, signUserToken } from "@knocklabs/node";

let client: Knock | null = null;
export function knock() {
  client ??= new Knock({ apiKey: process.env.KNOCK_SECRET_KEY });
  return client;
}

export const FEED_CHANNEL_ID = () => process.env.KNOCK_FEED_CHANNEL_ID!;

export interface KnockPerson {
  id: number;
  name: string;
}
const person = (p: KnockPerson) => ({ id: String(p.id), name: p.name });

// Enhanced security is on (#13): the browser needs a token signed for exactly
// this user, or the feed API answers 400/403.
//
// The token must stay the same across loader runs. A fresh token on every
// revalidation (any form submit) makes KnockProvider rebuild its client, which
// drops the WebSocket and any realtime message that was on its way. So reuse
// one per user until it is close to expiring.
const TOKEN_TTL_S = 60 * 60;
const tokens = new Map<string, { token: string; expiresAt: number }>();
async function userToken(userId: string) {
  const cached = tokens.get(userId);
  if (cached && cached.expiresAt - Date.now() > 10 * 60_000)
    return cached.token;
  const token = await signUserToken(userId, {
    signingKey: process.env.KNOCK_SIGNING_KEY,
    expiresInSeconds: TOKEN_TTL_S,
  });
  tokens.set(userId, { token, expiresAt: Date.now() + TOKEN_TTL_S * 1000 });
  return token;
}

export async function knockFeedConfig(userId: number) {
  return {
    publicKey: process.env.KNOCK_PUBLIC_KEY!,
    feedChannelId: FEED_CHANNEL_ID(),
    userId: String(userId),
    userToken: await userToken(String(userId)),
  };
}

export function triggerCommentReplied(args: {
  recipient: KnockPerson;
  replier: KnockPerson;
  commentId: number; // the top-level comment that was replied to
  lessonTitle: string;
  courseTitle: string;
  url: string;
}) {
  return knock().workflows.trigger("comment-replied", {
    recipients: [person(args.recipient)],
    actor: person(args.replier),
    data: {
      comment_id: args.commentId,
      replier_name: args.replier.name,
      lesson_title: args.lessonTitle,
      course_title: args.courseTitle,
      url: args.url,
    },
  });
}

export function triggerCoursePurchased(args: {
  instructor: KnockPerson;
  buyer: KnockPerson;
  courseId: number;
  courseTitle: string;
}) {
  return knock().workflows.trigger("course-purchased", {
    recipients: [person(args.instructor)],
    actor: person(args.buyer),
    data: {
      course_id: args.courseId,
      course_title: args.courseTitle,
      buyer_name: args.buyer.name,
      url: `/instructor/${args.courseId}/students`,
    },
  });
}

export function triggerRefundRequested(args: {
  admins: KnockPerson[];
  student: KnockPerson;
  refundRequestId: number;
  courseTitle: string;
}) {
  return knock().workflows.trigger("refund-requested", {
    recipients: args.admins.map(person),
    actor: person(args.student),
    data: {
      refund_request_id: args.refundRequestId,
      student_name: args.student.name,
      course_title: args.courseTitle,
      url: "/admin/refunds",
    },
  });
}

// "Answering marks it read" (#11): once the recipient replies to their own
// comment's thread, their unread Comment Replied Notification for that
// comment is marked read. Grouped per comment_id, so there is one feed item
// per comment (plus possibly one still batching, which can't be reached yet).
export async function markAnsweredRead(recipientId: number, commentId: number) {
  const started = Date.now();
  const page = await knock().users.feeds.listItems(
    String(recipientId),
    FEED_CHANNEL_ID(),
    {
      source: "comment-replied",
      status: "unread",
      trigger_data: JSON.stringify({ comment_id: commentId }),
    }
  );
  const ids = page.entries.map((e) => e.id);
  if (ids.length > 0)
    await knock().messages.batch.markAsRead({ message_ids: ids });
  console.log(
    `[knock-prototype] answered comment ${commentId}: marked ${ids.length} read for user ${recipientId} in ${Date.now() - started}ms`
  );
  return ids.length;
}
