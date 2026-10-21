# Cadence

An online course platform where Students buy Courses and Instructors publish them.

## Language

### People

**Student**:
A person who buys and takes Courses.
_Avoid_: Learner, customer, user

**Admin**:
Staff who decide Refund Requests. An Instructor may be consulted but never decides.
_Avoid_: Reviewer, support, team

### Purchases

**Purchase**:
A Student's payment for one Course, either for themselves or for Team Seats.
_Avoid_: Order, transaction

**Team Seat**:
One place in a Course bought as part of a team Purchase, which a Student claims to get an Enrollment. A Team Seat cannot be claimed while its Purchase has a Requested or Approved Refund Request, and unclaimed Team Seats stop being available once the Purchase is Refunded.
_Avoid_: Coupon, code, license

### Enrollments

**Enrollment**:
A Student's access to one Course. It ends when their Refund for that Course is Refunded; the Purchase and Refund Request remain as the record.
_Avoid_: Access grant, subscription

**Progress**:
A Student's record of Lessons completed, quizzes attempted and video watched in a Course. It belongs to the Student, not the Enrollment, so it outlives a Refund and returns if they buy the Course again.
_Avoid_: Enrollment progress

### Refunds

**Refund**:
The full Refund Amount given back to a Student for a Purchase, which ends their access to that Course once paid. There are no partial Refunds.
_Avoid_: Cancellation, reversal, chargeback

**Refund Request**:
A Student's ask, with a written reason, for a Refund on one Purchase. A Purchase gets at most one.
_Avoid_: Cancellation request, reversal request, pending chargeback

**Refund Amount**:
The amount the Student actually paid for the Purchase.
_Avoid_: Refundable amount, list price

**Refund Window**:
The fourteen calendar days after a Purchase, including the whole of the fourteenth day, in which a Refund Request may be made.
_Avoid_: Cancel window, cooling-off period

**Refund Eligibility**:
Whether a Purchase may receive a Refund Request: no earlier Refund Request, no earlier Refund for the same Course, inside the Refund Window, under two hours watched, under half the Lessons completed, and no claimed Team Seat. It is decided only when the Refund Request is made.
_Avoid_: Cancellation offer

### Refund statuses

**Requested**:
A Refund Request awaiting an Admin's decision.
_Avoid_: Pending, open

**Approved**:
A Refund Request an Admin has accepted; the money has not yet been paid and the Student keeps access.

**Declined**:
A Refund Request an Admin has rejected; nothing is paid back and the decision is final.
_Avoid_: Rejected, denied

**Refunded**:
An Approved Refund Request whose money an Admin has confirmed as sent; the Student's Enrollment ends, or for a team Purchase its unclaimed Team Seats are no longer available.
_Avoid_: Reversed, completed

### Refund emails

Each status has exactly one email, named and titled with the status word.

**Refund Requested email**:
Confirms to the Student that their Refund Request was received.
_Avoid_: Reversal email, cancellation confirmation

**Refund Approved email**:
Tells the Student an Admin accepted their Refund Request and payment is on its way.

**Refund Declined email**:
Tells the Student an Admin rejected their Refund Request.

**Refunded email**:
Tells the Student their money has been sent and their access to the Course has ended, or for a team Purchase that the unclaimed Team Seats from this Purchase are no longer available.

### Not used for Refunds

**Chargeback**:
A payment dispute the cardholder raises through their card issuer, outside this application. Never used to describe a Refund or Refund Request.

### Other terms

**Watch Limit**:
A Refund is only offered on a course with under two hours watched. Past that, the Learner has had the course, and the refund form turns them away.
_Avoid_: Watch cap, Viewing threshold

**Refunds table**:
`refunds` — one row per Refund. Columns: `id`, `purchase_id`, `status` (`open`, `approved`, `declined`), `reason`, `amount_refunded`, `requested_at`, `resolved_at`, `resolved_by_user_id`, `decision_note`.

**refunded_at**:
Nullable text column on `coupons`. An ISO timestamp, set on every unclaimed coupon when its team purchase is refunded. `getSeatAvailability` returns `"refunded"` for it.

**resolved_by_user_id**:
Integer column on `refunds`, referencing `users.id`. Null until an Admin approves or declines the Refund.

**RefundRequestCard**:
The component that draws one Refund Request on `/admin/refunds`, with its Approve and Decline buttons.

**Button**:
A clickable element that fires an action when the user presses it. Built on `~/components/ui/button`.

**Component**:
A React function that returns JSX.

**cwd**:
The directory the dev server was started from. Paths in `scripts/` resolve from here.

**Loader**:
The React Router function that fetches a route's data on the server before the page renders.

**Slug**:
The URL-safe name of a course, as in `/courses/:slug`.

**Lapsed**:
An Enrollment that is no longer active. Shown as a badge on the instructor's student roster.

**Instructor**:
Speaks for their own courses only. An Instructor builds and edits the courses they own, and sees the learners enrolled on them.
_Avoid_: Teacher, Author, Creator

**Watched**:
Seconds of video a Learner has actually played in a course: the furthest point reached in each lesson, added up. Not lessons opened.
_Avoid_: Viewed, Progress
