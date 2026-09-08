/**
 * Dashboard aggregations.
 *
 * Every number here is computed from live collections — there are no cached or
 * hardcoded figures anywhere, so a brand-new install legitimately reports zeros
 * and the UI renders its empty states.
 */
import dayjs from 'dayjs';
import LoanApplication from '../models/LoanApplication.js';
import LoanAccount from '../models/LoanAccount.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import Bank from '../models/Bank.js';
import EMISchedule from '../models/EMISchedule.js';
import {
  APPLICATION_STATUS,
  OPEN_UNDERWRITING_STATUSES,
  LIVE_LOAN_STATUSES,
  LOAN_STATUS,
  ROLES,
  EMI_STATUS,
} from '../constants/index.js';
import { DELINQUENCY_BUCKETS, round2 } from '../utils/emi.js';
import { refreshAllDelinquency, refreshBorrowerDelinquency } from './loanService.js';
import { getNextDue } from './paymentService.js';
import { getRecentActivity } from './auditService.js';

/** Counts grouped by a field, returned as a plain object with zero defaults. */
async function countBy(Model, field, match = {}, keys = []) {
  const rows = await Model.aggregate([
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);

  const result = Object.fromEntries(keys.map((key) => [key, 0]));
  rows.forEach((row) => {
    if (row._id != null) result[row._id] = row.count;
  });
  return result;
}

/** Admin KPIs, ageing, trends and the recent activity feed. */
export async function getAdminDashboard() {
  await refreshAllDelinquency();

  const statusKeys = Object.values(APPLICATION_STATUS);

  const [
    applicationsByStatus,
    totalApplications,
    loansByStatus,
    disbursedAgg,
    portfolioAgg,
    totalCustomers,
    totalStaff,
    totalBanks,
    bucketRows,
    activity,
    collectedAgg,
  ] = await Promise.all([
    countBy(LoanApplication, 'status', {}, statusKeys),
    LoanApplication.countDocuments({}),
    countBy(LoanAccount, 'status', {}, Object.values(LOAN_STATUS)),
    LoanAccount.aggregate([
      { $group: { _id: null, total: { $sum: '$sanctionedAmount' }, net: { $sum: '$disbursedAmount' } } },
    ]),
    LoanAccount.aggregate([
      { $match: { status: { $in: LIVE_LOAN_STATUSES } } },
      {
        $group: {
          _id: null,
          principalOutstanding: { $sum: '$principalOutstanding' },
          overdueAmount: { $sum: '$overdueAmount' },
        },
      },
    ]),
    User.countDocuments({ role: ROLES.CUSTOMER }),
    User.countDocuments({ role: { $ne: ROLES.CUSTOMER } }),
    Bank.countDocuments({}),
    LoanAccount.aggregate([
      { $match: { status: { $in: LIVE_LOAN_STATUSES } } },
      { $group: { _id: '$bucket', accounts: { $sum: 1 }, amount: { $sum: '$overdueAmount' } } },
    ]),
    getRecentActivity(15),
    Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);

  const buckets = Object.fromEntries(bucketRows.map((row) => [row._id, row]));

  // Six-month disbursement + application trend for the dashboard charts.
  const since = dayjs().subtract(5, 'month').startOf('month').toDate();

  const [disbursementTrend, applicationTrend] = await Promise.all([
    LoanAccount.aggregate([
      { $match: { disbursedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$disbursedAt' } },
          amount: { $sum: '$sanctionedAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    LoanApplication.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // Emit a continuous 6-month axis so the chart never has gaps.
  const months = Array.from({ length: 6 }, (_, i) =>
    dayjs().subtract(5 - i, 'month').format('YYYY-MM')
  );
  const disbMap = Object.fromEntries(disbursementTrend.map((r) => [r._id, r]));
  const appMap = Object.fromEntries(applicationTrend.map((r) => [r._id, r]));

  const trend = months.map((month) => ({
    month,
    label: dayjs(`${month}-01`).format('MMM'),
    disbursedAmount: round2(disbMap[month]?.amount ?? 0),
    disbursedCount: disbMap[month]?.count ?? 0,
    applications: appMap[month]?.count ?? 0,
  }));

  const pendingReview = OPEN_UNDERWRITING_STATUSES.reduce(
    (sum, status) => sum + (applicationsByStatus[status] ?? 0),
    0
  );

  return {
    kpis: {
      totalApplications,
      pendingReview,
      approved:
        (applicationsByStatus[APPLICATION_STATUS.APPROVED] ?? 0) +
        (applicationsByStatus[APPLICATION_STATUS.OFFER_ACCEPTED] ?? 0) +
        (applicationsByStatus[APPLICATION_STATUS.AGREEMENT_SIGNED] ?? 0),
      rejected: applicationsByStatus[APPLICATION_STATUS.REJECTED] ?? 0,
      disbursed: applicationsByStatus[APPLICATION_STATUS.DISBURSED] ?? 0,
      totalDisbursedAmount: round2(disbursedAgg[0]?.total ?? 0),
      netDisbursedAmount: round2(disbursedAgg[0]?.net ?? 0),
      activeLoans: (loansByStatus[LOAN_STATUS.ACTIVE] ?? 0) + (loansByStatus[LOAN_STATUS.OVERDUE] ?? 0),
      closedLoans: (loansByStatus[LOAN_STATUS.CLOSED] ?? 0) + (loansByStatus[LOAN_STATUS.FORECLOSED] ?? 0),
      overdueAccounts: loansByStatus[LOAN_STATUS.OVERDUE] ?? 0,
      principalOutstanding: round2(portfolioAgg[0]?.principalOutstanding ?? 0),
      totalOverdueAmount: round2(portfolioAgg[0]?.overdueAmount ?? 0),
      totalCollected: round2(collectedAgg[0]?.total ?? 0),
      totalCustomers,
      totalStaff,
      totalUsers: totalCustomers + totalStaff,
      totalBanks,
    },
    applicationsByStatus,
    loansByStatus,
    overdueBuckets: DELINQUENCY_BUCKETS.filter((b) => b !== 'current').map((bucket) => ({
      bucket,
      label: bucket === '90+' ? '90+ days' : `${bucket} days`,
      accounts: buckets[bucket]?.accounts ?? 0,
      amount: round2(buckets[bucket]?.amount ?? 0),
    })),
    trend,
    recentActivity: activity,
  };
}

/** Customer dashboard: application stepper state, active loan, next EMI, ledger. */
export async function getCustomerDashboard(userId) {
  // Only this borrower's loans — see refreshBorrowerDelinquency.
  await refreshBorrowerDelinquency(userId);

  const [applications, loans, payments] = await Promise.all([
    LoanApplication.find({ applicant: userId }).sort({ createdAt: -1 }).limit(5).lean(),
    LoanAccount.find({ borrower: userId }).sort({ createdAt: -1 }).lean(),
    Payment.find({ borrower: userId }).sort({ paidAt: -1 }).limit(5).populate('loanAccount', 'loanNo').lean(),
  ]);

  const activeLoan = loans.find((loan) => LIVE_LOAN_STATUSES.includes(loan.status)) ?? null;
  const nextDue = activeLoan ? await getNextDue(activeLoan._id) : null;

  // The most recent application that has not reached a terminal state.
  const currentApplication =
    applications.find(
      (app) =>
        ![APPLICATION_STATUS.DISBURSED, APPLICATION_STATUS.REJECTED, APPLICATION_STATUS.CANCELLED].includes(
          app.status
        )
    ) ?? applications[0] ?? null;

  const totalRepaid = round2(loans.reduce((sum, loan) => sum + (loan.totalPaid || 0), 0));
  const totalOutstanding = round2(
    loans
      .filter((loan) => LIVE_LOAN_STATUSES.includes(loan.status))
      .reduce((sum, loan) => sum + (loan.principalOutstanding || 0), 0)
  );

  let paidInstallments = 0;
  if (activeLoan) {
    paidInstallments = await EMISchedule.countDocuments({
      loanAccount: activeLoan._id,
      status: { $in: [EMI_STATUS.PAID, EMI_STATUS.WAIVED] },
    });
  }

  return {
    kpis: {
      activeLoans: loans.filter((l) => LIVE_LOAN_STATUSES.includes(l.status)).length,
      totalBorrowed: round2(loans.reduce((sum, loan) => sum + (loan.sanctionedAmount || 0), 0)),
      totalRepaid,
      totalOutstanding,
      overdueAmount: round2(
        loans.reduce((sum, loan) => sum + (loan.overdueAmount || 0), 0)
      ),
      openApplications: applications.filter((app) =>
        [
          APPLICATION_STATUS.DRAFT,
          ...OPEN_UNDERWRITING_STATUSES,
          APPLICATION_STATUS.APPROVED,
          APPLICATION_STATUS.OFFER_ACCEPTED,
          APPLICATION_STATUS.AGREEMENT_SIGNED,
        ].includes(app.status)
      ).length,
    },
    currentApplication,
    applications,
    activeLoan: activeLoan
      ? {
          ...activeLoan,
          paidInstallments,
          progressPct: activeLoan.tenureMonths
            ? Math.round((paidInstallments / activeLoan.tenureMonths) * 100)
            : 0,
        }
      : null,
    loans,
    nextDue,
    recentPayments: payments,
  };
}

export default { getAdminDashboard, getCustomerDashboard };
