import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, refunds, users, RefundStatus } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import {
  REFUND_INELIGIBLE_MESSAGES,
  buildRefundRequestedEmail,
} from "~/lib/refunds";
import { getRefundOffer } from "~/lib/refunds.server";
import { sendEmail } from "~/lib/mailer.server";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const student = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!student) {
    throw data("User not found", { status: 404 });
  }

  const offer = getRefundOffer(currentUserId, course.id);

  if (!offer.eligible) {
    if (offer.reason === "no_purchase") {
      throw data("You have not bought this course.", { status: 403 });
    }
    throw data(REFUND_INELIGIBLE_MESSAGES[offer.reason], {
      status: offer.reason === "earlier_refund_request" ? 409 : 403,
    });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  db.insert(refunds)
    .values({
      purchaseId: offer.purchase.id,
      status: RefundStatus.Requested,
      reason: parsed.data.reason,
    })
    .run();

  const email = buildRefundRequestedEmail({
    studentName: student.name,
    studentEmail: student.email,
    courseTitle: course.title,
    refundAmount: offer.refundAmount,
  });

  await sendEmail(email);

  return redirect("/settings");
}
