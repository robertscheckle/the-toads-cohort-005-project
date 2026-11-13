import { useEffect } from "react";
import {
  data,
  isRouteErrorResponse,
  Link,
  useFetcher,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { RefundStatus } from "~/db/schema";
import { requireAdmin } from "~/lib/access.server";
import { parseFormData } from "~/lib/validation";
import { REFUND_STATUS_LABELS } from "~/lib/refunds";
import {
  applyRefundDecision,
  listRefundRequests,
  type RefundReviewRow,
} from "~/lib/refunds.server";
import { sendEmail } from "~/lib/mailer.server";
import { notifyRefundDecided } from "~/lib/notification-events.server";
import { formatPrice } from "~/lib/utils";
import { RefundStatusBadge } from "~/components/refund-status-badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle, ReceiptText } from "lucide-react";

// "all" shows every status; the default is Requested, the ones waiting on an
// Admin.
const FILTERS = [
  RefundStatus.Requested,
  RefundStatus.Approved,
  RefundStatus.Declined,
  RefundStatus.Refunded,
  "all",
] as const;

type Filter = (typeof FILTERS)[number];

function parseFilter(value: string | null): Filter {
  return FILTERS.find((filter) => filter === value) ?? RefundStatus.Requested;
}

const refundDecisionSchema = z.object({
  refundId: z.coerce.number().int(),
  decision: z.enum(["approve", "decline", "mark_refunded"]),
});

export function meta() {
  return [
    { title: "Refunds — Cadence" },
    { name: "description", content: "Decide Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const filter = parseFilter(new URL(request.url).searchParams.get("status"));
  const refundRequests = listRefundRequests(filter === "all" ? null : filter);

  return { filter, refundRequests };
}

export async function action({ request }: Route.ActionArgs) {
  const { userId } = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundDecisionSchema);

  if (!parsed.success) {
    return data({ error: "Invalid refund decision." }, { status: 400 });
  }

  const result = applyRefundDecision(
    parsed.data.refundId,
    parsed.data.decision,
    userId
  );

  if (!result.ok) {
    return data({ error: result.message }, { status: result.httpStatus });
  }

  await sendEmail(result.email);
  await notifyRefundDecided(parsed.data.refundId);

  return { success: true, status: result.status };
}

function formatWatched(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { filter, refundRequests } = loaderData;
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ReceiptText className="size-7" />
          Refunds
        </h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline Refund Requests, then mark Approved ones Refunded
          once the money has been sent.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <Button
            key={option}
            variant={option === filter ? "default" : "outline"}
            size="sm"
            onClick={() => setSearchParams({ status: option })}
          >
            {option === "all" ? "All" : REFUND_STATUS_LABELS[option]}
          </Button>
        ))}
      </div>

      {refundRequests.length === 0 ? (
        <p className="text-muted-foreground">
          {filter === "all"
            ? "There are no refund requests."
            : `There are no ${REFUND_STATUS_LABELS[filter]} refund requests.`}
        </p>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refund) => (
            <RefundRequestCard key={refund.id} refund={refund} />
          ))}
        </div>
      )}
    </div>
  );
}

function RefundRequestCard({ refund }: { refund: RefundReviewRow }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data) toast.error(fetcher.data.error);
    else toast.success(`Refund request ${REFUND_STATUS_LABELS[fetcher.data.status]}.`);
  }, [fetcher.state, fetcher.data]);

  function decide(decision: "approve" | "decline" | "mark_refunded") {
    fetcher.submit(
      { refundId: String(refund.id), decision },
      { method: "post" }
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link
              to={`/courses/${refund.courseSlug}`}
              className="font-semibold hover:underline"
            >
              {refund.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {refund.studentName} · {refund.studentEmail}
              {refund.isTeamPurchase && " · team Purchase"}
            </p>
          </div>
          <RefundStatusBadge status={refund.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Refund Amount</dt>
            <dd className="font-medium">{formatPrice(refund.refundAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Requested</dt>
            <dd>{new Date(refund.requestedAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Refund Window</dt>
            <dd>
              {refund.daysLeftInWindow > 0
                ? `${refund.daysLeftInWindow} day${refund.daysLeftInWindow === 1 ? "" : "s"} left`
                : `Closed ${refund.lastDayInWindow}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Progress</dt>
            <dd>
              {refund.completedLessonCount}/{refund.totalLessonCount} lessons ·{" "}
              {formatWatched(refund.secondsWatched)} watched
            </dd>
          </div>
        </dl>

        <blockquote className="border-l-2 pl-3 text-sm">{refund.reason}</blockquote>

        {refund.resolvedAt && (
          <p className="text-xs text-muted-foreground">
            {REFUND_STATUS_LABELS[refund.status]}{" "}
            {new Date(refund.resolvedAt).toLocaleDateString()}
            {refund.resolvedByName && ` by ${refund.resolvedByName}`}
            {refund.amountRefunded !== null &&
              ` · ${formatPrice(refund.amountRefunded)} refunded`}
          </p>
        )}

        {refund.status === RefundStatus.Requested && (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => decide("approve")}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => decide("decline")}
            >
              Decline
            </Button>
          </div>
        )}

        {refund.status === RefundStatus.Approved && (
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const ending = refund.isTeamPurchase
                  ? "Its unclaimed Team Seats will no longer be available."
                  : `${refund.studentName}'s access to the course will end.`;
                if (
                  confirm(
                    `Confirm ${formatPrice(refund.refundAmount)} has been sent? ${ending}`
                  )
                ) {
                  decide("mark_refunded");
                }
              }}
            >
              Mark Refunded
            </Button>
            <span className="text-xs text-muted-foreground">
              Only once the money has been sent.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refunds.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
