/**
 * The customer's origination journey for one application.
 *
 * The screen is a stepper plus exactly one "active step" panel, so there is
 * always a single obvious next action and no dead ends: KYC -> documents ->
 * credit check -> offer -> e-sign -> payout account -> awaiting disbursement.
 * Terminal states (rejected, disbursed, withdrawn) get their own panel.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  Upload,
  Gauge,
  BadgeCheck,
  FileSignature,
  Landmark,
  Trash2,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Ban,
  ExternalLink,
  Camera as CameraIcon,
} from 'lucide-react';
import { TESTIDS, rowId } from '@shared/testIds.js';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Card, CardHeader, CardBody, DataGrid, DataItem } from '../../components/ui/Card.jsx';
import { StatusBadge, Badge } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input, Select, Checkbox } from '../../components/ui/Field.jsx';
import { Stepper } from '../../components/ui/Stepper.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import {
  EmptyState,
  LoadingState,
  WorkingState,
  ErrorState,
  FormError,
} from '../../components/ui/States.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { http } from '../../lib/api.js';
import { currency, date, dateTime, titleCase, fileSize } from '../../lib/format.js';
import {
  APPLICATION_STATUS,
  DOCUMENT_TYPES,
  BUREAU_SIMULATIONS,
} from '../../lib/constants.js';
import { fieldErrorsOf, cn } from '../../lib/utils.js';
import { IS_NATIVE, captureDocument } from '../../lib/native.js';

const SCORE_TONE = (score) => {
  if (score >= 750) return 'success';
  if (score >= 650) return 'warning';
  return 'danger';
};

/**
 * Which panel to show. Derived from status + completion of each sub-step.
 *
 * A plain function rather than a `useMemo`, because it can only be computed
 * once the application has loaded — and a hook below the loading/error early
 * returns changes the hook count between renders, which React rejects.
 */
function deriveActiveStep({
  application,
  documents,
  status,
  bureau,
  isRejected,
  isCancelled,
  isDisbursed,
}) {
  if (isRejected) return 'rejected';
  if (isCancelled) return 'cancelled';
  if (isDisbursed) return 'disbursed';

  if (application.kyc?.status !== 'verified') return 'kyc';
  if (documents.length === 0) return 'documents';

  if (status === APPLICATION_STATUS.SENT_BACK) return 'sent_back';
  if (status === APPLICATION_STATUS.IN_REVIEW) return 'in_review';

  /*
   * Decided statuses are checked BEFORE the bureau gate. An officer can
   * approve or send back an application without anyone pulling a bureau
   * report, and when that happened the borrower used to be pinned on the
   * credit-check panel with an offer already waiting behind it — no way
   * forward at all.
   */
  if (status === APPLICATION_STATUS.OFFER_ACCEPTED) return 'esign';
  if (status === APPLICATION_STATUS.AGREEMENT_SIGNED) {
    return application.bankAccount?.verified ? 'awaiting_disbursement' : 'bank';
  }
  if (status === APPLICATION_STATUS.APPROVED) return 'offer';

  if (!bureau) return 'bureau';
  return 'documents';
}

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  /**
   * Opens a document in a new tab. The bytes come from an authorised endpoint,
   * so this fetches them with the session token rather than letting the
   * browser navigate — a plain link would arrive unauthenticated.
   */
  /**
   * Captures a document with the device camera. Photographing a payslip is
   * the natural action on a phone; the file picker stays for anything
   * already saved, and both feed the same upload.
   */
  const takePhoto = async () => {
    try {
      const captured = await captureDocument({ source: 'camera' });
      if (!captured) return; // cancelled
      setFile(captured);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.info('Photo captured', 'Press Upload to send it for verification.');
    } catch (err) {
      toast.error('Could not open the camera', err.message);
    }
  };

  const openDocument = async (doc) => {
    try {
      await http.openFile(`/documents/${doc._id}/file`);
    } catch (err) {
      toast.error('Cannot open this document', err.message);
    }
  };
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['application', id],
    queryFn: () => http.get(`/applications/${id}`),
  });

  const { data: timelineData } = useQuery({
    queryKey: ['application', id, 'timeline'],
    queryFn: () => http.get(`/applications/${id}/timeline`),
    enabled: !!data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['application', id] });
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  /* ------------------------- Mutations ------------------------- */

  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState({});

  const onMutationError = (err) => {
    setFormError(err.message);
    setErrors(fieldErrorsOf(err));
    toast.error('Could not complete this step', err.message);
  };

  const clearErrors = () => {
    setFormError('');
    setErrors({});
  };

  // --- KYC ---
  const [kyc, setKyc] = useState({ pan: '', aadhaar: '' });
  const submitKyc = useMutation({
    mutationFn: (payload) => http.post(`/applications/${id}/kyc`, payload),
    onMutate: clearErrors,
    onSuccess: () => {
      invalidate();
      toast.success('KYC verified', 'Your PAN and Aadhaar were verified successfully.');
    },
    onError: onMutationError,
  });

  // --- Documents ---
  const fileInputRef = useRef(null);
  const [docType, setDocType] = useState('income_proof');
  const [file, setFile] = useState(null);

  const uploadDocument = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('type', docType);
      body.append('file', file);
      return http.post(`/applications/${id}/documents`, body);
    },
    onMutate: clearErrors,
    onSuccess: () => {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      invalidate();
      toast.success('Document uploaded', 'It will be verified by our operations team.');
    },
    onError: onMutationError,
  });

  const deleteDocument = useMutation({
    mutationFn: (documentId) => http.delete(`/documents/${documentId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Document removed');
    },
    onError: onMutationError,
  });

  // --- Bureau ---
  const [simulate, setSimulate] = useState('random');
  const pullBureau = useMutation({
    mutationFn: () => http.post(`/applications/${id}/bureau`, { simulate }),
    onMutate: clearErrors,
    onSuccess: (result) => {
      invalidate();
      const decision = result.decision?.decision;
      if (decision === 'auto_approved') {
        toast.success('Approved!', 'Your offer is ready — review and accept it below.');
      } else if (decision === 'auto_rejected') {
        toast.error('Application not approved', result.decision.reason);
      } else {
        toast.info('Sent for review', 'A credit officer will review your application shortly.');
      }
    },
    onError: onMutationError,
  });

  // --- Offer ---
  const acceptOffer = useMutation({
    mutationFn: () => http.post(`/applications/${id}/offer/accept`),
    onMutate: clearErrors,
    onSuccess: () => {
      invalidate();
      toast.success('Offer accepted', 'Now e-sign your loan agreement.');
    },
    onError: onMutationError,
  });

  // --- e-sign ---
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState('');
  const [consent, setConsent] = useState(false);

  const requestEsignOtp = useMutation({
    mutationFn: () => http.post(`/applications/${id}/agreement/otp`),
    onMutate: clearErrors,
    onSuccess: (result) => {
      setDevCode(result.devCode || '');
      toast.info('OTP sent', 'Check the demo hint below — no real SMS is sent.');
    },
    onError: onMutationError,
  });

  const signAgreement = useMutation({
    mutationFn: () => http.post(`/applications/${id}/agreement/sign`, { code: otp }),
    onMutate: clearErrors,
    onSuccess: () => {
      setOtp('');
      setDevCode('');
      invalidate();
      toast.success('Agreement signed', 'Add your payout account so we can release the funds.');
    },
    onError: onMutationError,
  });

  // --- Payout account ---
  const [bank, setBank] = useState({ accountHolder: '', accountNumber: '', ifsc: '' });
  const verifyBank = useMutation({
    mutationFn: (payload) => http.post(`/applications/${id}/bank-account`, payload),
    onMutate: clearErrors,
    onSuccess: () => {
      invalidate();
      toast.success('Account verified', 'A ₹1 penny drop confirmed your account details.');
    },
    onError: onMutationError,
  });

  // --- Withdraw ---
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const withdraw = useMutation({
    mutationFn: () => http.post(`/applications/${id}/withdraw`),
    onSuccess: () => {
      setWithdrawOpen(false);
      invalidate();
      toast.success('Application withdrawn');
      navigate('/app/applications');
    },
    onError: (err) => {
      setWithdrawOpen(false);
      onMutationError(err);
    },
  });

  /* ------------------------- Render ------------------------- */

  if (isLoading) return <LoadingState label="Loading your application…" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { application, documents = [] } = data;
  const status = application.status;
  const bureau = application.bureauReport;
  const offer = application.offer;

  const isRejected = status === APPLICATION_STATUS.REJECTED;
  const isCancelled = status === APPLICATION_STATUS.CANCELLED;
  const isDisbursed = status === APPLICATION_STATUS.DISBURSED;
  const canWithdraw = !isDisbursed && !isCancelled && !isRejected;

  const activeStep = deriveActiveStep({
    application,
    documents,
    status,
    bureau,
    isRejected,
    isCancelled,
    isDisbursed,
  });

  const timeline = timelineData?.timeline ?? [];

  return (
    <div data-testid={TESTIDS.applicationDetail.root}>
      <PageHeader
        breadcrumb={
          <Link to="/app/applications" className="hover:text-slate-700">
            My applications
          </Link>
        }
        title={
          <span data-testid={TESTIDS.applicationDetail.number}>{application.applicationNo}</span>
        }
        subtitle={`${currency(application.amountRequested)} over ${application.tenureRequested} months · ${titleCase(application.purpose)}`}
        actions={
          <>
            <StatusBadge status={status} size="md" testId={TESTIDS.applicationDetail.status} />
            {canWithdraw ? (
              <Button
                variant="secondary"
                size="sm"
                icon={Ban}
                onClick={() => setWithdrawOpen(true)}
                data-testid={TESTIDS.applicationDetail.withdraw}
              >
                Withdraw
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-5">
        <CardBody>
          <Stepper
            current={application.stage}
            failed={isRejected || isCancelled}
            testId={TESTIDS.applicationDetail.stepper}
          />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {formError ? <FormError message={formError} /> : null}

          {/* ---------------- KYC ---------------- */}
          {activeStep === 'kyc' ? (
            <Card testId={TESTIDS.applicationDetail.kycSection}>
              <CardHeader
                title="Step 1 — Verify your identity"
                subtitle="Enter your PAN and Aadhaar. Verification is simulated; nothing is sent to a real authority."
              />
              <CardBody>
                <form
                  className="space-y-4"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = {};
                    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(kyc.pan.toUpperCase()))
                      next.pan = 'Enter a valid PAN (e.g. ABCDE1234F).';
                    if (!/^\d{12}$/.test(kyc.aadhaar.replace(/\s/g, '')))
                      next.aadhaar = 'Aadhaar must be 12 digits.';
                    setErrors(next);
                    if (Object.keys(next).length) return;

                    submitKyc.mutate({
                      pan: kyc.pan.toUpperCase(),
                      aadhaar: kyc.aadhaar.replace(/\s/g, ''),
                    });
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="PAN"
                      name="pan"
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      value={kyc.pan}
                      onChange={(event) => setKyc({ ...kyc, pan: event.target.value.toUpperCase() })}
                      error={errors.pan}
                      hint="Use any valid-format PAN. AAAAA0000A always fails, for testing."
                      testId={TESTIDS.applicationDetail.panInput}
                      required
                    />
                    <Input
                      label="Aadhaar number"
                      name="aadhaar"
                      inputMode="numeric"
                      placeholder="123412341234"
                      maxLength={12}
                      value={kyc.aadhaar}
                      onChange={(event) =>
                        setKyc({ ...kyc, aadhaar: event.target.value.replace(/\D/g, '').slice(0, 12) })
                      }
                      error={errors.aadhaar}
                      hint="Only the last 4 digits are stored."
                      testId={TESTIDS.applicationDetail.aadhaarInput}
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    icon={ShieldCheck}
                    loading={submitKyc.isPending}
                    data-testid={TESTIDS.applicationDetail.kycSubmit}
                  >
                    Verify identity
                  </Button>
                </form>
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Documents ---------------- */}
          {['documents', 'sent_back', 'bureau'].includes(activeStep) ? (
            <Card testId={TESTIDS.applicationDetail.documentsSection}>
              <CardHeader
                title={
                  activeStep === 'sent_back'
                    ? 'More information needed'
                    : 'Step 2 — Upload supporting documents'
                }
                subtitle={
                  activeStep === 'sent_back'
                    ? 'Our credit team has asked for more information. Upload what is requested below and it will go straight back for review.'
                    : 'Add your income proof and address proof. JPG, PNG or PDF, up to 5 MB each.'
                }
              />
              <CardBody className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select
                      label="Document type"
                      name="documentType"
                      value={docType}
                      onChange={(event) => setDocType(event.target.value)}
                      options={DOCUMENT_TYPES}
                      testId={TESTIDS.applicationDetail.documentTypeSelect}
                    />
                    <div>
                      <label htmlFor="documentFile" className="label">
                        File
                      </label>
                      <input
                        ref={fileInputRef}
                        id="documentFile"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                        data-testid={TESTIDS.applicationDetail.documentFileInput}
                        className="block h-10 w-full cursor-pointer rounded-lg border border-white/10 bg-white/[0.06] text-sm text-slate-600 backdrop-blur-glass file:mr-3 file:h-full file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-white/10 file:px-3 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-white/20"
                      />

                      {IS_NATIVE ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={CameraIcon}
                          className="mt-2 w-full"
                          onClick={takePhoto}
                          data-testid={TESTIDS.applicationDetail.documentCapture}
                        >
                          Take a photo instead
                        </Button>
                      ) : null}

                      {file ? (
                        <p className="mt-2 truncate text-xs text-slate-500">
                          Selected: {file.name}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <Button
                    icon={Upload}
                    disabled={!file}
                    loading={uploadDocument.isPending}
                    onClick={() => uploadDocument.mutate()}
                    data-testid={TESTIDS.applicationDetail.documentUpload}
                  >
                    Upload
                  </Button>
                </div>

                {documents.length === 0 ? (
                  <EmptyState
                    compact
                    icon={FileText}
                    title="No documents uploaded yet"
                    message="Add at least one document to continue."
                  />
                ) : (
                  <div className="table-scroll">
                    <table className="data-table" data-testid={TESTIDS.applicationDetail.documentsTable}>
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
                          <tr
                            key={doc._id}
                            data-testid={rowId(TESTIDS.applicationDetail.documentRow, doc._id)}
                          >
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
                                <p className="mt-1 max-w-[16rem] text-xs text-slate-500">
                                  {doc.remarks}
                                </p>
                              ) : null}
                            </td>
                            <td className="text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openDocument(doc)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-slate-800"
                                  aria-label={`Open ${titleCase(doc.type)}`}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </button>
                                {doc.verificationStatus !== 'verified' ? (
                                  <button
                                    type="button"
                                    onClick={() => deleteDocument.mutate(doc._id)}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-danger-500 transition hover:bg-danger-50"
                                    aria-label={`Remove ${titleCase(doc.type)}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
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

              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Bureau check ---------------- */}
          {activeStep === 'bureau' ? (
            <Card testId={TESTIDS.applicationDetail.bureauSection}>
              <CardHeader
                title="Step 3 — Credit bureau check"
                subtitle="We pull a simulated credit report and assess your application automatically."
              />
              <CardBody className="space-y-4">
                {pullBureau.isPending ? (
                  <WorkingState
                    title="Running your credit check"
                    message="Pulling the bureau report and scoring it against policy. This takes a moment."
                  />
                ) : null}

                <p className="rounded-lg bg-white/[0.04] px-3 py-2.5 text-xs text-slate-600">
                  This is a mocked bureau. Choose a score band below to see how the underwriting rules
                  respond — high scores are approved automatically, mid scores go to a credit officer,
                  and low scores are declined.
                </p>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Select
                    label="Simulated score band"
                    name="simulate"
                    value={simulate}
                    onChange={(event) => setSimulate(event.target.value)}
                    options={BUREAU_SIMULATIONS}
                    testId={TESTIDS.applicationDetail.bureauSimulate}
                  />
                  <Button
                    icon={Gauge}
                    loading={pullBureau.isPending}
                    disabled={documents.length === 0}
                    onClick={() => pullBureau.mutate()}
                    data-testid={TESTIDS.applicationDetail.bureauRun}
                  >
                    Run credit check
                  </Button>
                </div>

                {documents.length === 0 ? (
                  <p className="text-xs text-warning-700">
                    Upload at least one document before running the credit check.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Bureau result ---------------- */}
          {bureau ? (
            <Card>
              <CardHeader title="Your credit report" subtitle={`Pulled ${dateTime(bureau.pulledAt)}`} />
              <CardBody>
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4',
                        SCORE_TONE(bureau.score) === 'success' && 'border-success-500 text-success-700',
                        SCORE_TONE(bureau.score) === 'warning' && 'border-warning-500 text-warning-700',
                        SCORE_TONE(bureau.score) === 'danger' && 'border-danger-500 text-danger-700'
                      )}
                    >
                      <span
                        data-testid={TESTIDS.applicationDetail.bureauScore}
                        className="text-2xl font-semibold leading-none"
                      >
                        {bureau.score}
                      </span>
                      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        / 900
                      </span>
                    </div>
                    <div>
                      <Badge
                        tone={SCORE_TONE(bureau.score)}
                        size="md"
                        testId={TESTIDS.applicationDetail.bureauBand}
                      >
                        {titleCase(bureau.band)}
                      </Badge>
                      <p className="mt-2 text-xs text-slate-500">{bureau.provider}</p>
                    </div>
                  </div>

                  <DataGrid
                    className="flex-1"
                    columns={2}
                    data-testid={TESTIDS.applicationDetail.bureauSummary}
                  >
                    <DataItem label="Open accounts" value={bureau.summary?.openAccounts} />
                    <DataItem
                      label="Total outstanding"
                      value={currency(bureau.summary?.totalOutstanding)}
                    />
                    <DataItem
                      label="Enquiries (6 mo)"
                      value={bureau.summary?.enquiriesLast6Months}
                    />
                    <DataItem
                      label="Delinquencies (24 mo)"
                      value={bureau.summary?.delinquenciesLast24Months}
                    />
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
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Manual review ---------------- */}
          {activeStep === 'in_review' ? (
            <Card>
              <CardBody className="flex flex-col items-center py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-warning-50">
                  <Clock className="h-6 w-6 text-warning-600" />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">Your application is under review</h3>
                <p className="mt-1.5 max-w-md text-sm text-slate-500">
                  A credit officer is reviewing your file. You will be notified here as soon as a
                  decision is made — usually within one business day.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Offer ---------------- */}
          {activeStep === 'offer' ? (
            <Card testId={TESTIDS.applicationDetail.offerSection}>
              <CardHeader
                title="Step 4 — Your loan offer"
                subtitle={offer.expiresAt ? `Valid until ${date(offer.expiresAt)}` : undefined}
                actions={<Badge tone="success" size="md">Approved</Badge>}
              />
              <CardBody>
                <div className="rounded-card bg-gradient-to-br from-success-600 to-success-700 p-5 text-white">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/80">
                    Sanctioned amount
                  </p>
                  <p
                    data-testid={TESTIDS.applicationDetail.offerAmount}
                    className="mt-1 text-3xl font-semibold tracking-tight"
                  >
                    {currency(offer.amount)}
                  </p>
                  {offer.amount < application.amountRequested ? (
                    <p className="mt-1.5 text-xs text-white/80">
                      Revised from your requested {currency(application.amountRequested)} based on your
                      income and obligations.
                    </p>
                  ) : null}
                </div>

                <DataGrid className="mt-5" columns={4}>
                  <DataItem
                    label="Interest rate"
                    value={`${offer.roi}% p.a.`}
                    testId={TESTIDS.applicationDetail.offerRoi}
                  />
                  <DataItem
                    label="Tenure"
                    value={`${offer.tenureMonths} months`}
                    testId={TESTIDS.applicationDetail.offerTenure}
                  />
                  <DataItem
                    label="Monthly EMI"
                    value={currency(offer.emi, { decimals: 2 })}
                    testId={TESTIDS.applicationDetail.offerEmi}
                  />
                  <DataItem
                    label="Processing fee"
                    value={currency(offer.processingFee, { decimals: 2 })}
                    testId={TESTIDS.applicationDetail.offerFee}
                  />
                  <DataItem label="Total interest" value={currency(offer.totalInterest, { decimals: 2 })} />
                  <DataItem label="Total payable" value={currency(offer.totalPayable, { decimals: 2 })} />
                  <DataItem
                    label="You will receive"
                    value={currency(offer.amount - offer.processingFee, { decimals: 2 })}
                  />
                </DataGrid>

                <p className="mt-4 text-xs text-slate-500">
                  The processing fee is deducted from the disbursed amount. EMIs start one month after
                  disbursement.
                </p>

                <Button
                  className="mt-5"
                  size="lg"
                  icon={BadgeCheck}
                  loading={acceptOffer.isPending}
                  onClick={() => acceptOffer.mutate()}
                  data-testid={TESTIDS.applicationDetail.offerAccept}
                >
                  Accept this offer
                </Button>
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- e-Sign ---------------- */}
          {activeStep === 'esign' ? (
            <Card testId={TESTIDS.applicationDetail.esignSection}>
              <CardHeader
                title="Step 5 — e-Sign your agreement"
                subtitle="Confirm the terms with an OTP sent to your registered mobile."
              />
              <CardBody className="space-y-4">
                <div className="rounded-card border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                  I accept the SedBank Personal Loan of{' '}
                  <strong>{currency(offer.amount)}</strong> at <strong>{offer.roi}% p.a.</strong> for{' '}
                  <strong>{offer.tenureMonths} months</strong>, with a monthly EMI of{' '}
                  <strong>{currency(offer.emi, { decimals: 2 })}</strong>, and agree to the loan terms
                  and conditions.
                </div>

                <Checkbox
                  label="I have read and accept the loan terms and conditions."
                  name="consent"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  testId={TESTIDS.applicationDetail.esignConsent}
                />

                {!devCode ? (
                  <Button
                    icon={FileSignature}
                    disabled={!consent}
                    loading={requestEsignOtp.isPending}
                    onClick={() => requestEsignOtp.mutate()}
                    data-testid={TESTIDS.applicationDetail.esignRequestOtp}
                  >
                    Send OTP to sign
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <Input
                      label="Enter the 6-digit OTP"
                      name="esignOtp"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      error={errors.code}
                      className="sm:max-w-xs"
                      testId={TESTIDS.applicationDetail.esignOtpInput}
                    />

                    <p
                      data-testid={TESTIDS.applicationDetail.esignHint}
                      data-otp={devCode}
                      className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-700"
                    >
                      <span className="font-semibold">Demo environment:</span> your OTP is{' '}
                      <span className="font-mono font-bold">{devCode}</span> — no SMS was sent.
                    </p>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        icon={FileSignature}
                        disabled={otp.length !== 6}
                        loading={signAgreement.isPending}
                        onClick={() => signAgreement.mutate()}
                        data-testid={TESTIDS.applicationDetail.esignSubmit}
                      >
                        Sign agreement
                      </Button>
                      <Button
                        variant="ghost"
                        loading={requestEsignOtp.isPending}
                        onClick={() => requestEsignOtp.mutate()}
                      >
                        Resend OTP
                      </Button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Payout account ---------------- */}
          {activeStep === 'bank' ? (
            <Card testId={TESTIDS.applicationDetail.bankSection}>
              <CardHeader
                title="Step 6 — Where should we send the money?"
                subtitle="We verify the account with a simulated ₹1 penny drop before disbursing."
              />
              <CardBody>
                <form
                  className="space-y-4"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = {};
                    if (bank.accountHolder.trim().length < 2)
                      next.accountHolder = 'Enter the account holder name.';
                    if (!/^\d{9,18}$/.test(bank.accountNumber))
                      next.accountNumber = 'Account number must be 9–18 digits.';
                    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc.toUpperCase()))
                      next.ifsc = 'Enter a valid IFSC (e.g. HDFC0001234).';
                    setErrors(next);
                    if (Object.keys(next).length) return;

                    verifyBank.mutate({ ...bank, ifsc: bank.ifsc.toUpperCase() });
                  }}
                >
                  <Input
                    label="Account holder name"
                    name="accountHolder"
                    value={bank.accountHolder}
                    onChange={(event) => setBank({ ...bank, accountHolder: event.target.value })}
                    error={errors.accountHolder}
                    testId={TESTIDS.applicationDetail.bankHolderInput}
                    required
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Account number"
                      name="accountNumber"
                      inputMode="numeric"
                      maxLength={18}
                      placeholder="111122223333"
                      value={bank.accountNumber}
                      onChange={(event) =>
                        setBank({ ...bank, accountNumber: event.target.value.replace(/\D/g, '') })
                      }
                      error={errors.accountNumber}
                      hint="An account ending 0000 always fails, for testing."
                      testId={TESTIDS.applicationDetail.bankAccountInput}
                      required
                    />
                    <Input
                      label="IFSC"
                      name="ifsc"
                      maxLength={11}
                      placeholder="HDFC0001234"
                      value={bank.ifsc}
                      onChange={(event) => setBank({ ...bank, ifsc: event.target.value.toUpperCase() })}
                      error={errors.ifsc}
                      testId={TESTIDS.applicationDetail.bankIfscInput}
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    icon={Landmark}
                    loading={verifyBank.isPending}
                    data-testid={TESTIDS.applicationDetail.bankSubmit}
                  >
                    Verify account
                  </Button>
                </form>
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Awaiting disbursement ---------------- */}
          {activeStep === 'awaiting_disbursement' ? (
            <Card testId={TESTIDS.applicationDetail.awaitingDisbursement}>
              <CardBody className="flex flex-col items-center py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
                  <Clock className="h-6 w-6 text-brand-400" />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">Everything is signed and verified</h3>
                <p className="mt-1.5 max-w-md text-sm text-slate-500">
                  Our operations team is completing the final checks. Once the documents are verified,{' '}
                  {currency(offer.amount - offer.processingFee)} will be credited to your account
                  ending {application.bankAccount?.accountNumber?.slice(-4)}.
                </p>
                <p
                  data-testid={TESTIDS.applicationDetail.bankVerified}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Payout account verified
                </p>
              </CardBody>
            </Card>
          ) : null}

          {/* ---------------- Terminal states ---------------- */}
          {activeStep === 'rejected' ? (
            <Card testId={TESTIDS.applicationDetail.rejected}>
              <CardBody className="flex flex-col items-center py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-50">
                  <XCircle className="h-6 w-6 text-danger-600" />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">This application was not approved</h3>
                <p className="mt-1.5 max-w-md text-sm text-slate-600">
                  {application.rejectionReason || 'Your application did not meet our credit criteria.'}
                </p>
                <p className="mt-3 max-w-md text-xs text-slate-500">
                  You are welcome to apply again once your circumstances change — for example a higher
                  income, fewer existing obligations, or an improved credit score.
                </p>
                <Button className="mt-5" variant="secondary" onClick={() => navigate('/app/apply')}>
                  Start a new application
                </Button>
              </CardBody>
            </Card>
          ) : null}

          {activeStep === 'cancelled' ? (
            <Card>
              <CardBody className="flex flex-col items-center py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                  <Ban className="h-6 w-6 text-slate-400" />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">You withdrew this application</h3>
                <Button className="mt-5" variant="secondary" onClick={() => navigate('/app/apply')}>
                  Start a new application
                </Button>
              </CardBody>
            </Card>
          ) : null}

          {activeStep === 'disbursed' ? (
            <Card>
              <CardBody className="flex flex-col items-center py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-50">
                  <CheckCircle2 className="h-6 w-6 text-success-600" />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">Your loan has been disbursed</h3>
                <p className="mt-1.5 max-w-md text-sm text-slate-500">
                  Loan account {application.loanAccount?.loanNo} is now active. Manage your EMIs,
                  payments and statements from the loan page.
                </p>
                {application.loanAccount ? (
                  <Button
                    className="mt-5"
                    icon={ArrowRight}
                    iconRight
                    onClick={() => navigate(`/app/loans/${application.loanAccount._id}`)}
                  >
                    View my loan
                  </Button>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        {/* ---------------- Sidebar ---------------- */}
        <div className="space-y-5">
          <Card testId={TESTIDS.applicationDetail.summary}>
            <CardHeader title="Application summary" />
            <CardBody>
              <DataGrid columns={2}>
                <DataItem label="Requested" value={currency(application.amountRequested)} />
                <DataItem label="Tenure" value={`${application.tenureRequested} months`} />
                <DataItem label="Purpose" value={titleCase(application.purpose)} />
                <DataItem label="Applied on" value={date(application.createdAt)} />
                <DataItem
                  label="Monthly income"
                  value={currency(application.employment?.monthlyIncome)}
                />
                <DataItem
                  label="Existing EMI"
                  value={currency(application.employment?.existingEmi)}
                />
                <DataItem
                  label="KYC"
                  value={<StatusBadge status={application.kyc?.status} testId={TESTIDS.applicationDetail.kycStatus} />}
                />
                <DataItem
                  label="PAN"
                  value={application.kyc?.pan || '—'}
                  mono
                />
              </DataGrid>
            </CardBody>
          </Card>

          {application.remarks?.length ? (
            <Card testId={TESTIDS.applicationDetail.remarks}>
              <CardHeader title="Notes from our team" />
              <CardBody className="space-y-3">
                {[...application.remarks].reverse().map((remark, index) => (
                  <div key={index} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm text-slate-700">{remark.message}</p>
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      {remark.byName} · {dateTime(remark.at)}
                    </p>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <Card testId={TESTIDS.applicationDetail.timeline}>
            <CardHeader title="Activity" />
            <CardBody>
              {timeline.length === 0 ? (
                <p className="text-sm text-slate-500">No activity recorded yet.</p>
              ) : (
                <ol className="space-y-4">
                  {[...timeline].reverse().map((entry) => (
                    <li key={entry._id} className="relative flex gap-3 pl-1">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800">
                          {entry.description || titleCase(entry.action)}
                        </p>
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

      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title="Withdraw this application?"
        message="This cannot be undone. You will need to start a new application if you change your mind."
        confirmLabel="Withdraw application"
        loading={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
      />
    </div>
  );
}
