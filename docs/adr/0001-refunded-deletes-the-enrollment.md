# Marking a Refund Request Refunded deletes the Enrollment

Every access check reads only whether an Enrollment row exists, so when an Admin marks a Refund Request Refunded we delete the Student's Enrollment rather than giving Enrollments an ended status. The Purchase and the Refunded Refund Request already record who was refunded for which Course, when, how much and by whom, and Progress (lesson progress, quiz attempts, video watch events) is keyed by Student and Lesson rather than by Enrollment, so it survives untouched and returns if the Student buys the Course again.

## Considered Options

- **Soft end (an `endedAt` or status column on Enrollment).** Keeps the Student visible as "refunded" on the instructor's student list and in enrollment analytics, but every place that asks "is this Student enrolled?" would have to learn to ignore ended Enrollments, and missing one silently restores access. Rejected for that risk.

## Consequences

- A refunded Student stays on the instructor's student list as Lapsed, found through their Progress and Purchase rather than an Enrollment, but drops out of "enrollments in range" analytics. Reports that need refunded Students must join through Purchases and Refund Requests.
- Only `enrolledAt` and `completedAt` are lost; the first is effectively the Purchase date and the second is almost always empty, because Refund Eligibility rules out Students who completed half the Lessons.
