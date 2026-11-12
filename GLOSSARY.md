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

**Instructor**:
A person who builds and edits the Courses they own and sees their enrolled and Lapsed Students. They speak only for their own Courses.
_Avoid_: Teacher, Author, Creator

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
A Student's record of Lessons completed, quizzes attempted and Watch Time in a Course. It belongs to the Student, not the Enrollment, so it outlives a Refund and returns if they buy the Course again.
_Avoid_: Enrollment progress

**Watch Time**:
The seconds of video a Student has actually played in a Course: the furthest point reached in each Lesson, added up. Opening a Lesson does not count.
_Avoid_: Viewed, Viewing time

**Lapsed**:
A Student who once had an Enrollment in a Course and no longer does, but keeps their Progress.
_Avoid_: Refunded student, Former student, Inactive

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
Whether a Purchase may receive a Refund Request: no earlier Refund Request, no earlier Refund for the same Course, inside the Refund Window, under two hours of Watch Time, under half the Lessons completed, and no claimed Team Seat. It is decided only when the Refund Request is made.
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

### Notifications

**Notification**:
A message shown inside Cadence to one Student, Instructor or Admin about something that happened in a Course or Purchase they are involved in. It is separate from any email sent for the same event.
_Avoid_: Alert, Message, Inbox item, Activity

**Archived Notification**:
A Notification its recipient has removed from their list. It is hidden, not deleted, and no longer counts as unread.
_Avoid_: Dismissed, Deleted, Cleared

**Muted Notification type**:
A Notification type a person has chosen to stop receiving. It affects only future Notifications of that type, never ones already received or any email.
_Avoid_: Unsubscribed, Disabled, Turned off

**Grouped Notification**:
One Notification standing for several events of the same type about the same thing, such as several replies to one comment. It is read, archived and counted as one Notification.
_Avoid_: Digest, Batch, Summary

**Mandatory Notification type**:
A Notification type that cannot be muted: Refund Requested, Refund Approved, Refund Declined and Refunded.
_Avoid_: Required, Critical

### Notification types

Each type is named `<Subject> <Past-tense verb> Notification`. Nobody gets a Notification for their own action, or one about something they can no longer open.

**Refund Requested Notification**:
Tells every Admin that a Refund Request is waiting for a decision.

**Refund Approved Notification**:
Tells the Student an Admin accepted their Refund Request and payment is on its way.

**Refund Declined Notification**:
Tells the Student an Admin rejected their Refund Request.

**Refunded Notification**:
Tells the Student their money has been sent and their access to the Course has ended, or for a team Purchase that its unclaimed Team Seats are no longer available.

**Comment Replied Notification**:
Tells the author of a comment on a Lesson that someone replied to it.

**Comment Posted Notification**:
Tells an Instructor that a new comment, not a reply, was posted on one of their Lessons.

**Course Purchased Notification**:
Tells an Instructor that a Student made a Purchase of their Course, for themselves or for Team Seats.

**Purchase Refunded Notification**:
Tells an Instructor that a Purchase of their Course was Refunded.

**Course Rated Notification**:
Tells an Instructor that a Student rated their Course for the first time.

**Team Seat Claimed Notification**:
Tells the Student who made a team Purchase that one of its Team Seats was claimed.

### Not used for Refunds

**Chargeback**:
A payment dispute the cardholder raises through their card issuer, outside this application. Never used to describe a Refund or Refund Request.
