# PM-26B — Support, cancellation, refund and retention policy
DRAFT — UNPUBLISHED — NOT IN FORCE
Date: 28 October 2026. Source: the product owner's PM-26A decisions in [the decision matrix](../../GO_LIVE_MATRIX.md). This is proposed wording for a future policy, not a statement that these procedures or deletion jobs are already operating. Mandatory rights remain unaffected.

## 1. Scope and unresolved details
The intended service is for adults aged 18 or over resident in Switzerland or Liechtenstein. The first live release is planned for card payments and manual bidding; automatic bidding and TWINT remain disabled. The operator's identity, registered address, domain, support/privacy contacts, service providers and processing countries remain UNDECIDED. No provider has been selected by this draft.

## 2. Written support
We plan to provide written support, aiming for a first response within 2 business days on weekdays. This is a first-response target, not a resolution guarantee. We do not promise telephone or 24/7 support. Users should receive status information while a payment or dispute case is under review. The responsible person, actual contact channel, working calendar, resolution times and escalation arrangements remain UNDECIDED.

## 3. Vehicle cancellation and the service fee
The vehicle purchase price is separate from the CHF 30 platform service fee. Cancelling a vehicle sale and refunding that fee are separate decisions. Releasing an uncaptured reservation is different from refunding money already captured. The winning buyer pays the CHF 30 service fee on a successful sale.
- When another bid overtakes a buyer, that buyer's reservation is released.
- For a seller-caused cancellation, removal of a non-compliant listing or a platform error, the buyer is not charged the fee; if already charged, the fee is reviewed and refunded.
- Duplicate or erroneous charges are corrected.
- Buyer default does not trigger an automatic deduction. An admin reviews the reasons and the buyer's response. If default is confirmed, CHF 30 remains with the operator as a service fee; it is not paid to the seller.
- While a dispute is open, capture that has not yet occurred is suspended.

These are proposed procedures for implementation; they do not promise a bank release or refund delivery time.

## 4. Reason-based refund review
After a successful sale, a change of mind alone does not automatically entitle the buyer to a refund of the service fee under this proposed policy. Errors, missing service and disputes are reviewed on their merits. No additional unconditional goodwill-refund window has been chosen. Request and decision deadlines, evidence requirements, review after rejection, partial refunds and chargeback handling remain UNDECIDED. The local prototype's single-request/final-decision rule is not adopted as the live policy. This wording does not restrict mandatory rights.

## 5. Approved retention targets
| Category | Target |
| --- | --- |
| Closed support correspondence, unless protected as evidence | 6 months after closure |
| User messages unrelated to a transaction, unless protected as evidence | 6 months after the last activity |
| Security and technical logs, unless protected as evidence | 30 days |
| Backups | Rolling retention of 30 days |

These are approved product-policy targets, not statutory periods or a claim of implemented automatic deletion. The approved message activity rule is specified below; log timestamps and backup-cycle implementation remain to be documented.

PM-26D approved message rule: last activity is the latest conversation creation, message creation or appointment creation/update. Reading/viewing does not extend it. The threshold is 6 UTC calendar months, clamped to the last day of the target month. Any vehicle bid, reservation, sale or listing report, any open or closed conversation message report, or a pending/accepted appointment protects all messages in the conversation. Closed reports or disputes do not automatically remove protection. Only unlinked messages past the threshold qualify for a read-only candidate preview; nothing is deleted. Protection durations remain UNDECIDED. Log timestamps and backup-cycle implementation still require specification.

## 6. Protection exceptions and undecided periods
Retention periods for payments/transactions, contracts and acceptance records, and both open and closed dispute files remain UNDECIDED. Support correspondence, messages and logs that form transaction or dispute evidence are excluded from general automatic deletion. The approved message protection scope is specified above; other protection scopes and all undecided durations require a separate decision. An undecided period is not approval for indefinite retention.
Closing an account does not mean immediate deletion of every transaction record. No period is assigned here to account data, media or other unlisted categories. Deletion versus anonymisation, protection review and how deletion requests remain effective after backup restoration must be specified before implementation.

## 7. Publication and implementation
The operator/contact/provider details, remaining policy decisions and review of the final wording must be completed before publication. These drafts are not an active legal release and do not request user acceptance. No deletion schedule, payment operation or refund is activated by this document. The separate [implementation plan](../../RETENTION_PROTECTION_PLAN.md) records the technical boundaries.
