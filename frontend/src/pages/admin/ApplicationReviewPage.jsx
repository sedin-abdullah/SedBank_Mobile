/**
 * Applicant 360 view and the underwriting decision desk.
 *
 * Everything an officer needs on one screen: applicant and employment details,
 * the computed obligation-to-income position against policy, the bureau report,
 * documents with an inline viewer, the decision history and the audit timeline.
 *
 * Actions available depend on where the file is: approve/reject/send-back while
 * it is in the queue, document verification for ops, and disbursement once the
 * agreement is signed.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  Undo2,
  Banknote,
  ExternalLink,
  Check,
  X,
  AlertTriangle,
  User,
  Briefcase,
  Gauge,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { TESTIDS, rowId } from '@shared/testIds.js';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Card, CardHeader, CardBody, DataGrid, DataItem } from '../../components/ui/Card.jsx';
import { StatusBadge, Badge } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { ProgressBar } from '../../components/ui/Stepper.jsx';
import { EmptyState, LoadingState, ErrorState, FormError } from '../../components/ui/States.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { http } from '../../lib/api.js';
import { currency, date, dateTime, ratioPercent, titleCase, fileSize, maskAccount } from '../../lib/format.js';
import { APPLICATION_STATUS, ROLES } from '../../lib/constants.js';
import { fieldErrorsOf, cn } from '../../lib/utils.js';

const OPEN_STATUSES = [
  APPLICATION_STATUS.SUBMITTED,
  APPLICATION_STATUS.IN_REVIEW,
  APPLICATION_STATUS.SENT_BACK,
];

const DECISION_META = {
  approved: {
    title: 'Approve this application',
    label: 'Approve',
    variant: 'success',
    hint: 'You can revise the amount, rate or tenure before approving.',
  },
  rejected: {
    title: 'Reject this application',
    label: 'Reject',
    variant: 'danger',
    hint: 'The applicant will see your remark as the reason for the decision.',
  },
  sent_back: {
    title: 'Request more information',
    label: 'Send back',
    variant: 'primary',
    hint: 'Tell the applicant exactly what is missing — they will be asked to supply it.',
  },
};

export default function ApplicationReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  /**
   * Opens a document in a new tab. The bytes come from an authorised endpoint,
   * so this fetches them with the session token rather than letting the
   * browser navigate — a plain link would arrive unauthenticated.
   */
  const openDocument = async (doc) => {
    try {
      await http.openFile(`/documents/${doc._id}/file`);
    } catch (err) {
      toast.error('Cannot open this document', err.message);
    }
  };
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isAdmin = user.role === ROLES.ADMIN;
  const canDecide = isAdmin || user.role === ROLES.CREDIT_OFFICER;
  const canOperate = isAdmin || user.role === ROLES.OPS_OFFICER;

  const [decision, setDecision] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [revised, setRevised] = useState({ amount: '', roi: '', tenure: '' });
  const [errors, setErrors] = useState({});
  const [decisionError, setDecisionError] = useState('');

  const [disburseOpen, setDisburseOpen] = useState(false);
  const [bankId, setBankId] = useState('');
  const [disburseError, setDisburseError] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['application', id],
    queryFn: () => http.get(`/applications/${id}`),
  });

  const { data: timelineData } = useQuery({
    queryKey: ['application', id, 'timeline'],
    queryFn: () => http.get(`/applications/${id}/timeline`),
    enabled: !!data,
  });

  const { data: decisionsData } = useQuery({
    queryKey: ['application', id, 'decisions'],
    queryFn: () => http.get(`/applications/${id}/decisions`),
    enabled: !!data,
  });

  const { data: banksData } = useQuery({
    queryKey: ['banks', 'disbursement'],
    queryFn: () => http.list('/banks', { params: { type: 'disbursement', status: 'active', limit: 100 } }),
    enabled: disburseOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['application', id] });
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['loans'] });
  };

  const submitDecision = useMutation({
    mutationFn: (payload) => http.post(`/underwriting/${id}/decision`, payload),
    onMutate: () => {
      setDecisionError('');
      setErrors({});
    },
    onSuccess: (_result, variables) => {
      setDecision(null);
      setRemarks('');
      setRevised({ amount: '', roi: '', tenure: '' });
      invalidate();
      toast.success(
        `Application ${variables.decision.replace('_', ' ')}`,
        'The applicant has been notified.'
      );
    },
    onError: (err) => {
      setDecisionError(err.message);
      setErrors(fieldErrorsOf(err));
    },
  });

  const verifyDocument = useMutation({
    mutationFn: ({ documentId, status }) =>
      http.patch(`/documents/${documentId}/verify`, {
        status,
        remarks: status === 'rejected' ? 'Not legible or does not match the application.' : 'Verified.',
      }),
    onSuccess: (_result, variables) => {
      invalidate();
      toast.success(`Document ${variables.status}`);
    },
    onError: (err) => toast.error('Could not update the document', err.message),
  });

  const disburse = useMutation({
    mutationFn: () => http.post(`/loans/disburse/${id}`, bankId ? { bankId } : {}),
    onMutate: () => setDisburseError(''),
    onSuccess: (result) => {
      setDisburseOpen(false);
      invalidate();
      toast.success(
        'Loan disbursed',
        `${result.loan.loanNo} created — ${currency(result.loan.disbursedAmount)} released.`
      );
      navigate(`/admin/loans/${result.loan._id}`);
    },
    onError: (err) => {
      setDisburseError(err.message);
    },
  });

  const openDecision = (kind) => {
    setDecision(kind);
    setDecisionError('');
    setErrors({});
    setRemarks('');
    if (kind === 'approved' && data?.application?.offer?.amount) {
      const offer = data.application.offer;
      setRevised({
        amount: String(offer.amount),
        roi: String(offer.roi),
        tenure: String(offer.tenureMonths),
      });
    }
  };

  const confirmDecision = () => {
    const next = {};
    if (remarks.trim().length < 5) next.remarks = 'Enter a remark of at least 5 characters.';

    if (decision === 'approved') {
      if (!(Number(revised.amount) > 0)) next.approvedAmount = 'Enter the approved amount.';
      if (!(Number(revised.roi) > 0)) next.roi = 'Enter the interest rate.';
      if (!(Number(revised.tenure) > 0)) next.tenureMonths = 'Enter the tenure in months.';
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    submitDecision.mutate({
      decision,
      remarks: remarks.trim(),
      ...(decision === 'approved'
        ? {
            approvedAmount: Number(revised.amount),
            roi: Number(revised.roi),
            tenureMonths: Number(revised.tenure),
          }
        : {}),
    });
  };

  if (isLoading) return <LoadingState label="Loading the application…" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { application, documents = [], obligations } = data;
  const bureau = application.bureauReport;
  const offer = application.offer;
  const applicant = application.applicant;

  const inQueue = OPEN_STATUSES.includes(application.status);
  const readyToDisburse = application.status === APPLICATION_STATUS.AGREEMENT_SIGNED;
  const pendingDocs = documents.filter((doc) => doc.verificationStatus === 'pending');

  /**
   * Everything ops must confirm before funds can be released.
   *
   * `blocking: false` items are shown for diligence but do not gate the
   * button. The bureau report is one: an officer can approve an application
   * without anyone pulling a report, and the API does not require one either
   * — so blocking on it left a manually-approved loan permanently
   * un-disbursable, with the credit decision already made and the agreement
   * already signed.
   */
  const checklist = [
    { label: 'KYC verified', done: application.kyc?.status === 'verified' },
    { label: 'Bureau report on file', done: !!bureau, blocking: false },
    { label: 'Offer accepted by applicant', done: !!offer?.acceptedAt },
    { label: 'Loan agreement e-signed', done: !!application.agreement?.signedAt },
    { label: 'Payout account penny-drop verified', done: !!application.bankAccount?.verified },
    /*
     * "Nothing pending", not "something present" — the same rule the API
     * enforces. Documents are optional, so a borrower who uploaded none is
     * not blocked; an upload nobody has looked at still is.
     */
    {
      label: documents.length
        ? `All documents verified (${documents.length - pendingDocs.length}/${documents.length})`
        : 'No documents uploaded — optional',
      done: pendingDocs.length === 0,
    },
  ];
  const checklistComplete = checklist.every((item) => item.done || item.blocking === false);

  return (
    <div data-testid={TESTIDS.adminReview.root}>
      <PageHeader
        breadcrumb={
          <Link to="/admin/applications" className="hover:text-slate-700">
            Applications
          </Link>
        }
        title={<span data-testid={TESTIDS.adminReview.number}>{application.applicationNo}</span>}
        subtitle={`${applicant?.name} · ${currency(application.amountRequested)} over ${application.tenureRequested} months · ${titleCase(application.purpose)}`}
        actions={
          <>
            <StatusBadge status={application.status} size="md" testId={TESTIDS.adminReview.status} />

            {inQueue && canDecide ? (
              <>
                <Button
                  variant="success"
                  size="sm"
                  icon={CheckCircle2}
                  onClick={() => openDecision('approved')}
                  data-testid={TESTIDS.adminReview.approve}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Undo2}
                  onClick={() => openDecision('sent_back')}
                  data-testid={TESTIDS.adminReview.sendBack}
                >
                  Request info
                </Button>
                <Button
                  variant="outlineDanger"
                  size="sm"
                  icon={XCircle}
                  onClick={() => openDecision('rejected')}
                  data-testid={TESTIDS.adminReview.reject}
                >
                  Reject
                </Button>
              </>
            ) : null}

            {readyToDisburse && canOperate ? (
              <Button
                size="sm"
                icon={Banknote}
                onClick={() => setDisburseOpen(true)}
                data-testid={TESTIDS.adminReview.disburse}
              >
                Disburse loan
              </Button>
            ) : null}
          </>
        }
      />

      {application.status === APPLICATION_STATUS.DISBURSED && application.loanAccount ? (
        <div className="mb-5 flex flex-col gap-3 rounded-card border border-success-200 bg-success-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-success-800">
            Disbursed as loan account{' '}
            <span className="font-mono font-semibold">{application.loanAccount.loanNo}</span>.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/admin/loans/${application.loanAccount._id}`)}
          >
            Open loan account
          </Button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* ---------------- Applicant ---------------- */}
          <Card testId={TESTIDS.adminReview.applicantPanel}>
            <CardHeader
              title="Applicant"
              actions={<Badge tone="neutral">{titleCase(application.kyc?.status || 'not started')} KYC</Badge>}
            />
            <CardBody>
              <DataGrid columns={3}>
                <DataItem label="Name" value={applicant?.name} />
                <DataItem label="Email" value={applicant?.email} />
                <DataItem label="Mobile" value={applicant?.mobile} />
                <DataItem label="PAN" value={application.kyc?.pan || '—'} mono />
                <DataItem
                  label="Aadhaar"
                  value={application.kyc?.aadhaarLast4 ? `XXXX XXXX ${application.kyc.aadhaarLast4}` : '—'}
                  mono
                />
                <DataItem label="Customer since" value={date(applicant?.createdAt)} />
                <DataItem label="Date of birth" value={date(application.personal?.dob)} />
                <DataItem label="Gender" value={titleCase(application.personal?.gender) || '—'} />
                <DataItem
                  label="Address"
                  value={
                    [
                      application.personal?.addressLine1,
                      application.personal?.city,
                      application.personal?.state,
                      application.personal?.pincode,
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'
                  }
                />
              </DataGrid>
            </CardBody>
          </Card>

          {/* ---------------- Employment & affordability ---------------- */}
          <Card testId={TESTIDS.adminReview.employmentPanel}>
            <CardHeader title="Employment and affordability" />
            <CardBody>
              <DataGrid columns={3}>
                <DataItem label="Employment type" value={titleCase(application.employment?.type)} />
                <DataItem label="Employer" value={application.employment?.employerName || '—'} />
                <DataItem label="Experience" value={`${application.employment?.experienceYears ?? 0} years`} />
                <DataItem label="Monthly income" value={currency(obligations.monthlyIncome)} />
                <DataItem label="Existing EMI" value={currency(obligations.existingEmi)} />
                <DataItem label="Proposed EMI" value={currency(obligations.proposedEmi, { decimals: 2 })} />
              </DataGrid>

              <div
                data-testid={TESTIDS.adminReview.obligationsPanel}
                className="mt-5 rounded-card border border-slate-200 bg-slate-50 p-4"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Obligation to income (FOIR)
                  </p>
                  <p
                    data-testid={TESTIDS.adminReview.foir}
                    className={cn(
                      'text-sm font-semibold',
                      obligations.withinPolicy ? 'text-success-700' : 'text-danger-700'
                    )}
                  >
                    {ratioPercent(obligations.projectedFoir)} of {ratioPercent(obligations.maxFoir, 0)} limit
                  </p>
                </div>

                <ProgressBar
                  value={
                    obligations.maxFoir
                      ? Math.min(100, (obligations.projectedFoir / obligations.maxFoir) * 100)
                      : 0
                  }
                  tone={obligations.withinPolicy ? 'success' : 'danger'}
                />

                <p className="mt-3 text-xs text-slate-600">
                  {obligations.withinPolicy
                    ? `Existing obligations of ${currency(obligations.existingEmi)} plus the proposed EMI stay within the ${ratioPercent(obligations.maxFoir, 0)} policy limit.`
                    : `Combined obligations exceed the ${ratioPercent(obligations.maxFoir, 0)} policy limit. Approving at these terms is an override and will be recorded as one.`}
                </p>
              </div>
            </CardBody>
          </Card>

          {/* ---------------- Bureau ---------------- */}
          <Card testId={TESTIDS.adminReview.bureauPanel}>
            <CardHeader
              title="Credit bureau report"
              subtitle={bureau ? `${bureau.provider} · pulled ${dateTime(bureau.pulledAt)}` : undefined}
            />
            <CardBody>
              {!bureau ? (
                <EmptyState
                  compact
                  icon={Gauge}
                  title="No bureau report yet"
                  message="The applicant has not run the credit check for this application."
                />
              ) : (
                <>
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4',
                          bureau.score >= 750
                            ? 'border-success-500 text-success-700'
                            : bureau.score >= 650
                              ? 'border-warning-500 text-warning-700'
                              : 'border-danger-500 text-danger-700'
                        )}
                      >
                        <span
                          data-testid={TESTIDS.adminReview.bureauScore}
                          className="text-2xl font-semibold leading-none"
                        >
                          {bureau.score}
                        </span>
                        <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                          / 900
                        </span>
                      </div>
                      <Badge
                        tone={bureau.score >= 750 ? 'success' : bureau.score >= 650 ? 'warning' : 'danger'}
                        size="md"
                      >
                        {titleCase(bureau.band)}
                      </Badge>
                    </div>

                    <DataGrid className="flex-1" columns={2}>
                      <DataItem label="Open accounts" value={bureau.summary?.openAccounts} />
                      <DataItem label="Total outstanding" value={currency(bureau.summary?.totalOutstanding)} />
                      <DataItem label="Enquiries (6 mo)" value={bureau.summary?.enquiriesLast6Months} />
                      <DataItem
                        label="Delinquencies (24 mo)"
                        value={bureau.summary?.delinquenciesLast24Months}
                      />
                      <DataItem
                        label="Credit utilisation"
                        value={`${bureau.summary?.creditUtilizationPct}%`}
                      />
                      <DataItem label="Write-offs" value={bureau.summary?.writeOffs} />
                    </DataGrid>
                  </div>

                  {bureau.reportJson?.factors?.length ? (
                    <ul className="mt-5 space-y-1.5 border-t border-slate-100 pt-4">
                      {bureau.reportJson.factors.map((factor) => (
                        <li key={factor} className="flex items-start gap-2 text-xs text-slate-600">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                          {factor}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>

          {/* ---------------- Documents ---------------- */}
          <Card testId={TESTIDS.adminReview.documentsPanel}>
            <CardHeader
              title="Documents"
              subtitle={
                documents.length
                  ? `${documents.length - pendingDocs.length} of ${documents.length} verified`
                  : undefined
              }
            />
            {documents.length === 0 ? (
              <EmptyState
                compact
                icon={FileText}
                title="No documents uploaded"
                message="The applicant has not attached any supporting documents yet."
              />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th className="hidden sm:table-cell">Uploaded</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc._id} data-testid={rowId(TESTIDS.adminReview.documentRow, doc._id)}>
                        <td>
                          <p className="font-medium text-slate-900">{titleCase(doc.type)}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {doc.originalName} · {fileSize(doc.sizeBytes)}
                          </p>
                        </td>
                        <td className="hidden sm:table-cell">{date(doc.createdAt)}</td>
                        <td>
                          <StatusBadge status={doc.verificationStatus} />
                          {doc.remarks ? (
                            <p className="mt-1 max-w-[14rem] text-xs text-slate-500">{doc.remarks}</p>
                          ) : null}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openDocument(doc)}
                              data-testid={TESTIDS.adminReview.documentView}
                              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-600 transition hover:bg-white/10"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              View
                            </button>

                            {canOperate && doc.verificationStatus !== 'verified' ? (
                              <button
                                type="button"
                                data-testid={TESTIDS.adminReview.documentVerify}
                                onClick={() =>
                                  verifyDocument.mutate({ documentId: doc._id, status: 'verified' })
                                }
                                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-success-700 transition hover:bg-success-50"
                              >
                                <Check className="h-3.5 w-3.5" />
                                Verify
                              </button>
                            ) : null}

                            {canOperate && doc.verificationStatus !== 'rejected' ? (
                              <button
                                type="button"
                                data-testid={TESTIDS.adminReview.documentReject}
                                onClick={() =>
                                  verifyDocument.mutate({ documentId: doc._id, status: 'rejected' })
                                }
                                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-danger-600 transition hover:bg-danger-50"
                              >
                                <X className="h-3.5 w-3.5" />
                                Reject
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ---------------- Sidebar ---------------- */}
        <div className="space-y-5">
          {offer?.amount ? (
            <Card>
              <CardHeader
                title={application.status === APPLICATION_STATUS.IN_REVIEW ? 'Recommended terms' : 'Sanctioned offer'}
                subtitle={
                  application.status === APPLICATION_STATUS.IN_REVIEW
                    ? 'Pre-computed by the rule engine — override if needed'
                    : undefined
                }
              />
              <CardBody>
                <DataGrid columns={2}>
                  <DataItem label="Amount" value={currency(offer.amount)} />
                  <DataItem label="Rate" value={`${offer.roi}% p.a.`} />
                  <DataItem label="Tenure" value={`${offer.tenureMonths} months`} />
                  <DataItem label="EMI" value={currency(offer.emi, { decimals: 2 })} />
                  <DataItem label="Processing fee" value={currency(offer.processingFee, { decimals: 2 })} />
                  <DataItem label="Total interest" value={currency(offer.totalInterest, { decimals: 2 })} />
                  {offer.acceptedAt ? (
                    <DataItem label="Accepted on" value={dateTime(offer.acceptedAt)} className="sm:col-span-2" />
                  ) : null}
                </DataGrid>
              </CardBody>
            </Card>
          ) : null}

          {application.bankAccount?.accountNumber ? (
            <Card>
              <CardHeader
                title="Payout account"
                actions={
                  application.bankAccount.verified ? (
                    <Badge tone="success">
                      <ShieldCheck className="h-3 w-3" />
                      Verified
                    </Badge>
                  ) : (
                    <Badge tone="warning">Unverified</Badge>
                  )
                }
              />
              <CardBody>
                <DataGrid columns={2}>
                  <DataItem label="Holder" value={application.bankAccount.accountHolder} />
                  <DataItem label="Bank" value={application.bankAccount.bankName} />
                  <DataItem label="Account" value={maskAccount(application.bankAccount.accountNumber)} mono />
                  <DataItem label="IFSC" value={application.bankAccount.ifsc} mono />
                </DataGrid>
              </CardBody>
            </Card>
          ) : null}

          {/* Decision history */}
          <Card testId={TESTIDS.adminReview.decisionsPanel}>
            <CardHeader title="Decision history" />
            <CardBody>
              {(decisionsData?.decisions ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No decisions recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {decisionsData.decisions.map((entry) => (
                    <li key={entry._id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge
                          tone={
                            entry.decision.includes('approved')
                              ? 'success'
                              : entry.decision.includes('rejected')
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {titleCase(entry.decision)}
                        </Badge>
                        <span className="text-[11px] text-slate-400">{dateTime(entry.decidedAt)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{entry.remarks}</p>
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        {entry.decidedByName}
                        {entry.score ? ` · score ${entry.score}` : ''}
                        {entry.dti ? ` · FOIR ${ratioPercent(entry.dti)}` : ''}
                      </p>
                      {entry.rulesApplied?.length ? (
                        <p className="mt-1.5 font-mono text-[10px] text-slate-400">
                          {entry.rulesApplied.join(' · ')}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Audit timeline */}
          <Card testId={TESTIDS.adminReview.timeline}>
            <CardHeader title="Audit trail" />
            <CardBody>
              {(timelineData?.timeline ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No activity recorded yet.</p>
              ) : (
                <ol className="scrollbar-thin max-h-96 space-y-4 overflow-y-auto">
                  {[...(timelineData?.timeline ?? [])].reverse().map((entry) => (
                    <li key={entry._id} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800">{entry.description || titleCase(entry.action)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {dateTime(entry.timestamp)} · {entry.performedByName}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* ---------------- Decision dialog ---------------- */}
      <Modal
        open={!!decision}
        onOpenChange={(open) => !open && setDecision(null)}
        title={decision ? DECISION_META[decision].title : ''}
        description={decision ? DECISION_META[decision].hint : ''}
        testId={TESTIDS.adminReview.decisionModal}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDecision(null)}
              data-testid={TESTIDS.adminReview.decisionCancel}
            >
              Cancel
            </Button>
            <Button
              variant={decision ? DECISION_META[decision].variant : 'primary'}
              loading={submitDecision.isPending}
              onClick={confirmDecision}
              data-testid={TESTIDS.adminReview.decisionConfirm}
            >
              {decision ? DECISION_META[decision].label : 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {decisionError ? <FormError message={decisionError} /> : null}

          {decision === 'approved' ? (
            <>
              {!obligations.withinPolicy ? (
                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-xs text-warning-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    These terms breach the {ratioPercent(obligations.maxFoir, 0)} FOIR limit. Approving
                    is recorded as a policy override in the audit trail.
                  </span>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Approved amount"
                  name="approvedAmount"
                  type="number"
                  prefix="₹"
                  value={revised.amount}
                  onChange={(event) => setRevised({ ...revised, amount: event.target.value })}
                  error={errors.approvedAmount}
                  testId={TESTIDS.adminReview.approvedAmountInput}
                  required
                />
                <Input
                  label="Interest rate (%)"
                  name="roi"
                  type="number"
                  step="0.1"
                  value={revised.roi}
                  onChange={(event) => setRevised({ ...revised, roi: event.target.value })}
                  error={errors.roi}
                  testId={TESTIDS.adminReview.roiInput}
                  required
                />
                <Input
                  label="Tenure (months)"
                  name="tenureMonths"
                  type="number"
                  value={revised.tenure}
                  onChange={(event) => setRevised({ ...revised, tenure: event.target.value })}
                  error={errors.tenureMonths}
                  testId={TESTIDS.adminReview.tenureInput}
                  required
                />
              </div>
            </>
          ) : null}

          <Textarea
            label="Remarks"
            name="remarks"
            rows={4}
            maxLength={1000}
            placeholder={
              decision === 'sent_back'
                ? 'e.g. The uploaded payslip is not legible — please upload the last three months.'
                : 'Explain the basis for this decision. The applicant will see this.'
            }
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            error={errors.remarks}
            hint="Recorded in the audit trail against your name."
            testId={TESTIDS.adminReview.remarksInput}
            required
          />
        </div>
      </Modal>

      {/* ---------------- Disbursement dialog ---------------- */}
      <Modal
        open={disburseOpen}
        onOpenChange={setDisburseOpen}
        title="Disburse this loan"
        description="Creates the loan account and generates the full EMI schedule."
        testId={TESTIDS.adminReview.disburseModal}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisburseOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={disburse.isPending}
              disabled={!checklistComplete}
              onClick={() => disburse.mutate()}
              data-testid={TESTIDS.adminReview.disburseConfirm}
            >
              Confirm disbursement
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {disburseError ? <FormError message={disburseError} /> : null}

          <ul data-testid={TESTIDS.adminReview.disburseChecklist} className="space-y-2">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-2.5 text-sm">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                    item.done
                      ? 'bg-success-500/15 text-success-500'
                      : item.blocking === false
                        ? 'bg-white/[0.06] text-slate-500'
                        : 'bg-danger-500/15 text-danger-500'
                  )}
                >
                  {item.done ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </span>
                <span className={item.done ? 'text-slate-700' : 'text-slate-500'}>
                  {item.label}
                  {!item.done && item.blocking === false ? (
                    <span className="ml-1.5 text-xs text-slate-500">
                      — not on file; approved on an officer's decision
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          {!checklistComplete ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-xs text-warning-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Every item must be complete before funds can be released. Verify the outstanding
                documents from the Documents panel.
              </span>
            </div>
          ) : null}

          <Select
            label="Disbursement account (optional)"
            name="bankId"
            value={bankId}
            onChange={(event) => setBankId(event.target.value)}
            placeholder="Not specified"
            options={(banksData?.items ?? []).map((bank) => ({
              value: bank._id,
              label: `${bank.name} (${bank.code})`,
            }))}
            hint={
              (banksData?.items ?? []).length === 0
                ? 'No active disbursement accounts are configured. An admin can add one under Partner banks.'
                : 'The house account the payout is booked against.'
            }
            testId={TESTIDS.adminReview.disburseBankSelect}
          />

          <div className="rounded-lg bg-slate-50 p-3">
            <DataGrid columns={2}>
              <DataItem label="Sanctioned" value={currency(offer?.amount)} />
              <DataItem label="Processing fee" value={currency(offer?.processingFee, { decimals: 2 })} />
              <DataItem
                label="Net to borrower"
                value={currency((offer?.amount ?? 0) - (offer?.processingFee ?? 0), { decimals: 2 })}
              />
              <DataItem label="First EMI" value={currency(offer?.emi, { decimals: 2 })} />
            </DataGrid>
          </div>
        </div>
      </Modal>
    </div>
  );
}
