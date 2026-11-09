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
A Student's payment for one Course.
_Avoid_: Order, transaction

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
Whether a Purchase may receive a Refund Request: no earlier Refund Request, inside the Refund Window, under two hours watched, under half the Lessons completed, and not a team seat someone has claimed.
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
An Approved Refund Request whose money an Admin has confirmed as sent; the Student's access to the Course ends.
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
Tells the Student their money has been sent and their access to the Course has ended.

### Not used for Refunds

**Chargeback**:
A payment dispute the cardholder raises through their card issuer, outside this application. Never used to describe a Refund or Refund Request.
