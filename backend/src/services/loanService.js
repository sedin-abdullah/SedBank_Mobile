/**
 * Loan Management (LMS): disbursement, amortisation, ledger balances,
 * delinquency ageing, foreclosure quotes and closure.
 *
 * Ledger invariant — within a single installment a payment is always applied in
 * the order penalty -> interest -> principal. Every balance in the system is
 * derived from the schedule rows using that rule (see `summariseSchedule`), so
 * the ledger can always be recomputed from first principles and never drifts.
 */
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import LoanAccount from '../models/LoanAccount.js';
import EMISchedule from '../models/EMISchedule.js';
import LoanApplication from '../models/LoanApplication.js';
import Document from '../models/Document.js';
import Bank from '../models/Bank.js';
import Payment from '../models/Payment.js';
import ApiError from '../utils/ApiError.js';
import {
  APPLICATION_STATUS,
  LOAN_STATUS,
  EMI_STATUS,
  LIVE_LOAN_STATUSES,
  VERIFICATION_STATUS,
  ROLES,
  EVENTS,
} from '../constants/index.js';
import {
  buildAmortisationSchedule,
  addMonthsClamped,
  daysPastDue,
  bucketForDpd,
  round2,
} from '../utils/emi.js';
import { getPolicy } from './configService.js';
import { recordAudit } from './auditService.js';
import { notifyUser, notifyStaff } from './notificationService.js';
import { emitToStaff, emitToUser, broadcastDataChange } from '../realtime/socket.js';

/* ------------------------------------------------------------------ */
/* Ledger derivation                                                   */
/* ------------------------------------------------------------------ */

/** Interest still owed on one installment (interest is settled before principal). */
export const interestOutstanding = (emi) =>
  emi.status === EMI_STATUS.WAIVED ? 0 : Math.max(0, round2(emi.interest - emi.amountPaid));

/** Principal still owed on one installment. */
export const principalOutstanding = (emi) =>
  emi.status === EMI_STATUS.WAIVED
    ? 0
    : Math.max(0, round2(emi.principal - Math.max(0, emi.amountPaid - emi.interest)));

/** Unpaid late fee on one installment. */
export const penaltyOutstanding = (emi) => Math.max(0, round2(emi.penalty - emi.penaltyPaid));

/** Total still owed on one installment, fees included. */
export const dueOnEmi = (emi) =>
  round2(interestOutstanding(emi) + principalOutstanding(emi) + penaltyOutstanding(emi));

/** Recomputes every ledger total from the schedule rows. */
export function summariseSchedule(schedule) {
  const totals = {
    principalOutstanding: 0,
    principalPaid: 0,
    interestPaid: 0,
    penaltyAccrued: 0,
    penaltyPaid: 0,
    totalPaid: 0,
    overdueAmount: 0,
    overdueEmiCount: 0,
    dpd: 0,
  };

  schedule.forEach((emi) => {
    totals.principalOutstanding += principalOutstanding(emi);
    totals.principalPaid += Math.min(emi.principal, Math.max(0, emi.amountPaid - emi.interest));
    totals.interestPaid += Math.min(emi.interest, emi.amountPaid);
    totals.penaltyAccrued += emi.penalty;
    totals.penaltyPaid += emi.penaltyPaid;
    totals.totalPaid += emi.amountPaid + emi.penaltyPaid;

    if (emi.status === EMI_STATUS.OVERDUE) {
      totals.overdueAmount += dueOnEmi(emi);
      totals.overdueEmiCount += 1;
      totals.dpd = Math.max(totals.dpd, emi.dpd || 0);
    }
  });

  Object.keys(totals).forEach((key) => {
    totals[key] = key === 'overdueEmiCount' || key === 'dpd' ? totals[key] : round2(totals[key]);
  });

  return totals;
}

/** Writes derived totals back onto the loan and returns it (unsaved). */
export function applyTotals(loan, schedule) {
  const totals = summariseSchedule(schedule);

  // Prepaid principal and one-off charges live on the loan, not the schedule.
  const prepaid = round2(loan.principalPrepaid || 0);
  const otherCharges = round2(loan.otherChargesPaid || 0);

  loan.principalOutstanding = totals.principalOutstanding;
  loan.principalPaid = round2(totals.principalPaid + prepaid);
  loan.interestPaid = totals.interestPaid;
  loan.penaltyAccrued = totals.penaltyAccrued;
  loan.penaltyPaid = totals.penaltyPaid;
  loan.totalPaid = round2(totals.totalPaid + prepaid + otherCharges);
  loan.overdueAmount = totals.overdueAmount;
  loan.overdueEmiCount = totals.overdueEmiCount;
  loan.dpd = totals.dpd;
  loan.bucket = bucketForDpd(totals.dpd);

  // Status only moves between the two "live" states here; closure is explicit.
  if (LIVE_LOAN_STATUSES.includes(loan.status)) {
    loan.status = totals.overdueEmiCount > 0 ? LOAN_STATUS.OVERDUE : LOAN_STATUS.ACTIVE;
  }

  return loan;
}

/** Marks a loan closed once nothing is outstanding. */
export async function closeIfSettled(loan, schedule, { reason = 'Loan fully repaid' } = {}) {
  const anythingLeft = schedule.some(
    (emi) => emi.status !== EMI_STATUS.PAID && emi.status !== EMI_STATUS.WAIVED
  );

  if (anythingLeft || loan.principalOutstanding > 0.5) return false;

  loan.status = LOAN_STATUS.CLOSED;
  loan.closedAt = new Date();
  loan.closureReason = reason;
  loan.principalOutstanding = 0;
  loan.overdueAmount = 0;
  loan.overdueEmiCount = 0;
  loan.dpd = 0;
  loan.bucket = 'current';
  return true;
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export async function loadLoan(id, actor, { populate = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid loan id.');

  let query = LoanAccount.findById(id);
  if (populate) {
    query = query
      .populate('borrower', 'name email mobile pan')
      .populate('application', 'applicationNo purpose bankAccount')
      .populate('disbursementBank', 'name code');
  }

  const loan = await query;
  if (!loan) throw ApiError.notFound('Loan account not found.');

  if (actor.role === ROLES.CUSTOMER) {
    const ownerId = loan.borrower?._id ?? loan.borrower;
    if (String(ownerId) !== String(actor._id)) {
      throw ApiError.forbidden('You do not have access to this loan account.');
    }
  }

  return loan;
}

export const getSchedule = (loanId) =>
  EMISchedule.find({ loanAccount: loanId }).sort({ installmentNo: 1 });

/* ------------------------------------------------------------------ */
/* Disbursement                                                        */
/* ------------------------------------------------------------------ */

/**
 * Converts a signed application into a live loan account and generates the
 * full amortisation schedule. This is the single point where a loan is born.
 */
export async function disburse({ applicationId, bankId, actor, ip = '' }) {
  const application = await LoanApplication.findById(applicationId).populate(
    'applicant',
    'name email mobile'
  );
  if (!application) throw ApiError.notFound('Application not found.');

  // --- Pre-disbursement gates ---------------------------------------------
  if (application.status === APPLICATION_STATUS.DISBURSED) {
    throw ApiError.conflict('This application has already been disbursed.');
  }
  if (application.status !== APPLICATION_STATUS.AGREEMENT_SIGNED) {
    throw ApiError.conflict(
      `The loan agreement must be e-signed before disbursement (current status: "${application.status}").`
    );
  }
  if (!application.bankAccount?.verified) {
    throw ApiError.conflict("The borrower's payout account has not been penny-drop verified.");
  }

  /*
   * Documents are optional, so their absence is not a gate: a borrower may
   * apply without uploading anything and still be disbursed.
   *
   * What remains a gate is an upload left *unresolved*. If a document was
   * submitted, someone must have looked at it — otherwise ops could disburse
   * against a payslip that was, in fact, about to be rejected. So the rule is
   * "nothing pending", not "something present".
   */
  const documents = await Document.find({ application: application._id }).lean();
  const unverified = documents.filter(
    (doc) => doc.verificationStatus !== VERIFICATION_STATUS.VERIFIED
  );
  if (unverified.length) {
    throw ApiError.conflict(
      `${unverified.length} document(s) still require verification before disbursement.`,
      unverified.map((doc) => ({ field: doc.type, message: `Status: ${doc.verificationStatus}` }))
    );
  }

  let bank = null;
  if (bankId) {
    bank = await Bank.findById(bankId);
    if (!bank) throw ApiError.badRequest('Selected disbursement bank does not exist.');
    if (bank.status !== 'active') throw ApiError.badRequest('Selected disbursement bank is inactive.');
  }

  const { product } = await getPolicy();
  const offer = application.offer;
  const disbursedAt = new Date();
  const firstEmiDate = addMonthsClamped(disbursedAt, 1);

  const loan = new LoanAccount({
    application: application._id,
    borrower: application.applicant._id,
    sanctionedAmount: offer.amount,
    roi: offer.roi,
    tenureMonths: offer.tenureMonths,
    emiAmount: offer.emi,
    processingFee: offer.processingFee,
    // The processing fee is deducted at source, as stated on the offer screen.
    disbursedAmount: round2(offer.amount - offer.processingFee),
    disbursedAt,
    disbursedBy: actor._id,
    disbursementBank: bank?._id ?? null,
    disbursementRef: `DISB-${Date.now().toString(36).toUpperCase()}`,
    startDate: disbursedAt,
    firstEmiDate,
    maturityDate: addMonthsClamped(disbursedAt, offer.tenureMonths),
    status: LOAN_STATUS.ACTIVE,
    principalOutstanding: offer.amount,
  });

  await loan.save();

  const rows = buildAmortisationSchedule({
    principal: offer.amount,
    annualRatePct: offer.roi,
    months: offer.tenureMonths,
    startDate: disbursedAt,
  });

  await EMISchedule.insertMany(
    rows.map((row) => ({
      ...row,
      loanAccount: loan._id,
      borrower: loan.borrower,
      status: EMI_STATUS.PENDING,
    }))
  );

  application.status = APPLICATION_STATUS.DISBURSED;
  application.stage = 'completed';
  application.loanAccount = loan._id;
  await application.save();

  await recordAudit({
    entity: 'LoanAccount',
    entityId: loan._id,
    action: 'loan.disbursed',
    description: `${loan.loanNo} disbursed — ₹${loan.disbursedAmount.toLocaleString('en-IN')} net of a ₹${loan.processingFee.toLocaleString('en-IN')} processing fee${bank ? ` via ${bank.name}` : ''}`,
    actor,
    meta: { applicationNo: application.applicationNo, loanNo: loan.loanNo },
    ip,
  });
  await recordAudit({
    entity: 'LoanApplication',
    entityId: application._id,
    action: 'application.disbursed',
    description: `Disbursed as loan ${loan.loanNo}`,
    actor,
    ip,
  });

  await notifyUser({
    userId: loan.borrower,
    title: 'Your loan has been disbursed!',
    message: `₹${loan.disbursedAmount.toLocaleString('en-IN')} has been credited towards loan ${loan.loanNo}. Your first EMI of ₹${loan.emiAmount.toLocaleString('en-IN')} is due on ${dayjs(firstEmiDate).format('DD MMM YYYY')}.`,
    type: 'success',
    category: 'loan',
    link: `/app/loans/${loan._id}`,
    alsoEmail: true,
  });

  emitToUser(loan.borrower, EVENTS.LOAN_UPDATED, { loanId: String(loan._id), status: loan.status });
  emitToStaff(EVENTS.LOAN_UPDATED, { loanId: String(loan._id), loanNo: loan.loanNo, status: loan.status });
  notifyStaff({
    title: 'Loan disbursed',
    message: `${loan.loanNo} — ₹${loan.disbursedAmount.toLocaleString('en-IN')}`,
    type: 'success',
    link: `/admin/loans/${loan._id}`,
  });
  broadcastDataChange(['loans', 'applications', 'dashboard'], { userId: loan.borrower });

  return { loan, application, product };
}

/* ------------------------------------------------------------------ */
/* Delinquency                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ages one loan: flags installments past their due date, charges the late fee
 * once per installment, and refreshes the loan's DPD / bucket snapshot.
 */
export async function refreshLoanDelinquency(loan, { policy = null, asOf = new Date() } = {}) {
  const { product } = policy ?? (await getPolicy());
  const schedule = await getSchedule(loan._id);

  const touched = [];

  schedule.forEach((emi) => {
    if ([EMI_STATUS.PAID, EMI_STATUS.WAIVED].includes(emi.status)) return;

    const dpd = daysPastDue(emi.dueDate, asOf);
    if (dpd <= 0) return;

    emi.dpd = dpd;
    emi.status = EMI_STATUS.OVERDUE;

    // The late fee is charged once, the first time the installment ages.
    if (!emi.penaltyAppliedAt && product.latePenaltyPct > 0) {
      emi.penalty = round2((emi.totalAmount * product.latePenaltyPct) / 100);
      emi.penaltyAppliedAt = new Date();
    }

    touched.push(emi);
  });

  if (touched.length) await Promise.all(touched.map((emi) => emi.save()));

  const previousBucket = loan.bucket;
  applyTotals(loan, schedule);
  loan.lastSweepAt = new Date();
  await loan.save();

  return { loan, schedule, changed: touched.length > 0, bucketChanged: previousBucket !== loan.bucket };
}

/**
 * Ages just one borrower's live loans.
 *
 * A borrower's dashboard shows their own loans, so sweeping the whole book to
 * render it is work proportional to every other customer's data — it was
 * taking 20s against ~15 loans and would grow linearly. The global sweep
 * still runs on boot and on the timer, so nothing goes stale.
 */
export async function refreshBorrowerDelinquency(userId, { asOf = new Date() } = {}) {
  const policy = await getPolicy();
  const loans = await LoanAccount.find({
    borrower: userId,
    status: { $in: LIVE_LOAN_STATUSES },
  });

  /*
   * Concurrently, unlike the global sweep below.
   *
   * Each refresh fetches that loan's whole schedule and writes back, so done
   * one at a time it cost ~600ms per loan on the borrower's dashboard — 1.2s
   * with no loans against 3.6s with four. The sweep is serial to keep memory
   * flat across every loan in the system; a single borrower holds a handful,
   * so there is nothing to protect against here and every reason not to pay
   * the round trips in sequence.
   */
  await Promise.all(loans.map((loan) => refreshLoanDelinquency(loan, { policy, asOf })));

  return { swept: loans.length };
}

/**
 * Sweeps every live loan. Runs on boot, on a timer, and lazily before any
 * collections/dashboard read so ageing figures are never stale.
 */
export async function refreshAllDelinquency({ asOf = new Date() } = {}) {
  const policy = await getPolicy();
  const loans = await LoanAccount.find({ status: { $in: LIVE_LOAN_STATUSES } });

  let updated = 0;
  const newlyOverdue = [];

  for (const loan of loans) {
    // eslint-disable-next-line no-await-in-loop -- sequential keeps free-tier memory flat
    const result = await refreshLoanDelinquency(loan, { policy, asOf });
    if (result.changed) updated += 1;
    if (result.bucketChanged && loan.bucket !== 'current') newlyOverdue.push(loan);
  }

  for (const loan of newlyOverdue) {
    // eslint-disable-next-line no-await-in-loop
    await notifyUser({
      userId: loan.borrower,
      title: 'EMI payment overdue',
      message: `Loan ${loan.loanNo} has ₹${loan.overdueAmount.toLocaleString('en-IN')} overdue (${loan.dpd} days). A late fee has been applied.`,
      type: 'warning',
      category: 'collections',
      link: `/app/loans/${loan._id}`,
      alsoEmail: true,
    });
  }

  if (updated) broadcastDataChange(['loans', 'collections', 'dashboard']);

  return { scanned: loans.length, updated };
}

/* ------------------------------------------------------------------ */
/* Foreclosure                                                         */
/* ------------------------------------------------------------------ */

/**
 * Settlement quote for closing a loan early.
 * Future interest is waived; only interest already accrued on due installments
 * is charged, plus outstanding late fees and the configured foreclosure charge.
 */
export async function getForeclosureQuote(loan, { asOf = new Date() } = {}) {
  const { product } = await getPolicy();
  const schedule = await getSchedule(loan._id);

  let principal = 0;
  let accruedInterest = 0;
  let penalty = 0;

  schedule.forEach((emi) => {
    if (emi.status === EMI_STATUS.WAIVED) return;
    principal += principalOutstanding(emi);
    penalty += penaltyOutstanding(emi);
    // Interest is only payable on installments that have already fallen due.
    if (dayjs(emi.dueDate).startOf('day').isBefore(dayjs(asOf).endOf('day'))) {
      accruedInterest += interestOutstanding(emi);
    }
  });

  principal = round2(principal);
  const foreclosureCharge = round2((principal * product.foreclosureChargePct) / 100);
  const payable = round2(principal + accruedInterest + penalty + foreclosureCharge);

  // What the borrower would have paid by running the loan to maturity.
  const scheduledRemaining = round2(
    schedule.reduce((sum, emi) => sum + dueOnEmi(emi), 0)
  );

  return {
    loanId: String(loan._id),
    loanNo: loan.loanNo,
    asOf,
    principalOutstanding: principal,
    accruedInterest: round2(accruedInterest),
    outstandingPenalty: round2(penalty),
    foreclosureChargePct: product.foreclosureChargePct,
    foreclosureCharge,
    totalPayable: payable,
    scheduledRemaining,
    interestSaved: round2(Math.max(0, scheduledRemaining - payable)),
    validTill: dayjs(asOf).endOf('day').toDate(),
  };
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export async function listLoans({ actor, filters = {}, page = 1, limit = 20 }) {
  const query = {};

  if (actor.role === ROLES.CUSTOMER) query.borrower = actor._id;
  if (filters.status && filters.status !== 'all') query.status = filters.status;
  if (filters.bucket && filters.bucket !== 'all') query.bucket = filters.bucket;
  if (filters.borrower) query.borrower = filters.borrower;

  if (filters.search) {
    const matchingBorrowers = await mongoose
      .model('User')
      .find({
        $or: [
          { name: { $regex: filters.search, $options: 'i' } },
          { email: { $regex: filters.search, $options: 'i' } },
          { mobile: { $regex: filters.search, $options: 'i' } },
        ],
      })
      .select('_id')
      .lean();

    query.$or = [
      { loanNo: { $regex: filters.search, $options: 'i' } },
      { borrower: { $in: matchingBorrowers.map((u) => u._id) } },
    ];
  }

  const [items, total] = await Promise.all([
    LoanAccount.find(query)
      .populate('borrower', 'name email mobile')
      .populate('application', 'applicationNo purpose')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LoanAccount.countDocuments(query),
  ]);

  return { items, total };
}

export const getPayments = (loanId) =>
  Payment.find({ loanAccount: loanId }).sort({ paidAt: -1 }).lean();

export default {
  loadLoan,
  getSchedule,
  disburse,
  refreshLoanDelinquency,
  refreshAllDelinquency,
  getForeclosureQuote,
  listLoans,
  getPayments,
  summariseSchedule,
  applyTotals,
  closeIfSettled,
  interestOutstanding,
  principalOutstanding,
  penaltyOutstanding,
  dueOnEmi,
};
