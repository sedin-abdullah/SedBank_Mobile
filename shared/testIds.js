/**
 * SedBank — single source of truth for `data-testid` values.
 *
 * Imported by BOTH the React components and the Playwright suite, so a testid
 * is never typed twice. See TESTIDS.md for the documented catalogue and the
 * desktop/mobile mapping.
 *
 * Convention: {portal}-{module}-{element}-{action?}, kebab-case.
 *   portal : login | customer | admin | shared | sidebar | mobile
 *   module : the screen or feature area
 *   element: what it is (btn, input, card, table, row, badge, modal, toast…)
 *
 * Stability rule: a testid identifies the LOGICAL element. It must not change
 * when styling, copy or layout changes — only when the element's purpose does.
 *
 * Responsive rule: the same testid must resolve at every breakpoint for the
 * same logical element. A separate id exists only where mobile renders a
 * genuinely different DOM node (the nav drawer) — those are paired as
 * `sidebar-nav-*` (desktop) and `mobile-nav-*` (drawer).
 */

/* ------------------------------------------------------------------ */
/* Dynamic id helpers — for list rows and other repeated elements.     */
/* ------------------------------------------------------------------ */

export const rowId = (module, id) => `${module}-row-${id}`;
export const cellId = (module, id, field) => `${module}-row-${id}-${field}`;
export const actionId = (module, id, action) => `${module}-row-${id}-${action}-btn`;
export const fieldError = (field) => `field-error-${field}`;
/** Bottom-tab item, phones only. Paired with navId/mobile-nav for the drawer. */
export const tabId = (key) => `app-tab-${key}`;

export const navId = (key, mobile = false) => `${mobile ? 'mobile' : 'sidebar'}-nav-${key}`;
export const stepId = (key) => `application-stepper-step-${key}`;
export const bucketCardId = (bucket) => `admin-collections-bucket-${bucket}-card`;
export const kpiId = (portal, key) => `${portal}-dashboard-kpi-${key}`;

export const TESTIDS = {
  /* ---------------- Shared shell & primitives ---------------- */
  shell: {
    root: 'app-shell',
    sidebar: 'app-sidebar',
    sidebarToggle: 'app-sidebar-toggle-btn',
    mobileNavOpen: 'app-mobile-nav-open-btn',
    mobileNavDrawer: 'app-mobile-nav-drawer',
    mobileNavClose: 'app-mobile-nav-close-btn',
    topbar: 'app-topbar',
    globalSearch: 'app-topbar-search-input',
    notificationBell: 'app-topbar-notification-bell-btn',
    notificationBadge: 'app-topbar-notification-badge',
    notificationPanel: 'app-topbar-notification-panel',
    notificationMarkAll: 'app-topbar-notification-mark-all-btn',
    notificationItem: 'app-topbar-notification-item',
    profileMenu: 'app-topbar-profile-menu-btn',
    profileName: 'app-topbar-profile-name',
    profileLink: 'app-topbar-profile-link',
    logout: 'app-topbar-logout-btn',
    pageTitle: 'app-page-title',
    breadcrumb: 'app-breadcrumb',
    connectionStatus: 'app-realtime-status',
    tabBar: 'app-tab-bar',
    tabMore: 'app-tab-more-btn',
  },

  common: {
    toast: 'app-toast',
    toastTitle: 'app-toast-title',
    toastClose: 'app-toast-close-btn',
    modal: 'app-modal',
    modalTitle: 'app-modal-title',
    modalClose: 'app-modal-close-btn',
    modalConfirm: 'app-modal-confirm-btn',
    modalCancel: 'app-modal-cancel-btn',
    emptyState: 'app-empty-state',
    emptyStateAction: 'app-empty-state-action-btn',
    loading: 'app-loading',
    errorState: 'app-error-state',
    errorRetry: 'app-error-retry-btn',
    formError: 'app-form-error',
    pagination: 'app-pagination',
    paginationPrev: 'app-pagination-prev-btn',
    paginationNext: 'app-pagination-next-btn',
    paginationInfo: 'app-pagination-info',
    statusBadge: 'app-status-badge',
    confirmDialog: 'app-confirm-dialog',
  },

  /* ---------------- Public / auth ---------------- */
  landing: {
    root: 'landing-page',
    login: 'landing-login-btn',
    register: 'landing-register-btn',
    checkEligibility: 'landing-check-eligibility-btn',
  },

  login: {
    root: 'login-page',
    tabPassword: 'login-tab-password-btn',
    tabOtp: 'login-tab-otp-btn',
    emailInput: 'login-email-input',
    passwordInput: 'login-password-input',
    submit: 'login-submit-btn',
    mobileInput: 'login-mobile-input',
    requestOtp: 'login-request-otp-btn',
    otpInput: 'login-otp-input',
    verifyOtp: 'login-verify-otp-btn',
    otpHint: 'login-otp-hint',
    error: 'login-error',
    toRegister: 'login-to-register-link',
    demoAdmin: 'login-demo-admin-btn',
    demoCustomer: 'login-demo-customer-btn',
    demoCredit: 'login-demo-credit-btn',
    demoOps: 'login-demo-ops-btn',
    demoCollections: 'login-demo-collections-btn',
    biometric: 'login-biometric-btn',
  },

  register: {
    root: 'register-page',
    nameInput: 'register-name-input',
    emailInput: 'register-email-input',
    mobileInput: 'register-mobile-input',
    passwordInput: 'register-password-input',
    submit: 'register-submit-btn',
    error: 'register-error',
    toLogin: 'register-to-login-link',
  },

  /* ---------------- Eligibility calculator ---------------- */
  eligibility: {
    root: 'customer-eligibility-page',
    incomeInput: 'customer-eligibility-income-input',
    employmentSelect: 'customer-eligibility-employment-select',
    existingEmiInput: 'customer-eligibility-existing-emi-input',
    amountInput: 'customer-eligibility-amount-input',
    tenureInput: 'customer-eligibility-tenure-input',
    submit: 'customer-eligibility-submit-btn',
    result: 'customer-eligibility-result',
    resultAmount: 'customer-eligibility-result-amount',
    resultEmi: 'customer-eligibility-result-emi',
    resultRoi: 'customer-eligibility-result-roi',
    ineligible: 'customer-eligibility-ineligible',
    applyNow: 'customer-eligibility-apply-btn',
  },

  /* ---------------- Customer portal ---------------- */
  customerDashboard: {
    lifecycle: 'customer-dashboard-lifecycle',
    repaymentGauge: 'customer-dashboard-repayment-gauge',
    root: 'customer-dashboard-page',
    activeLoanCard: 'customer-dashboard-active-loan-card',
    nextEmiCard: 'customer-dashboard-next-emi-card',
    totalRepaidCard: 'customer-dashboard-total-repaid-card',
    applicationStatusCard: 'customer-dashboard-application-status-card',
    stepper: 'customer-dashboard-stepper',
    quickApply: 'customer-dashboard-quick-apply-btn',
    quickPay: 'customer-dashboard-quick-pay-btn',
    quickStatement: 'customer-dashboard-quick-statement-btn',
    continueApplication: 'customer-dashboard-continue-application-btn',
    recentPayments: 'customer-dashboard-recent-payments',
    empty: 'customer-dashboard-empty-state',
  },

  apply: {
    root: 'customer-apply-page',
    stepper: 'customer-apply-stepper',
    amountInput: 'customer-apply-amount-input',
    tenureInput: 'customer-apply-tenure-input',
    purposeSelect: 'customer-apply-purpose-select',
    purposeNoteInput: 'customer-apply-purpose-note-input',
    employmentTypeSelect: 'customer-apply-employment-type-select',
    employerInput: 'customer-apply-employer-input',
    incomeInput: 'customer-apply-income-input',
    existingEmiInput: 'customer-apply-existing-emi-input',
    experienceInput: 'customer-apply-experience-input',
    fullNameInput: 'customer-apply-full-name-input',
    dobInput: 'customer-apply-dob-input',
    genderSelect: 'customer-apply-gender-select',
    address1Input: 'customer-apply-address1-input',
    cityInput: 'customer-apply-city-input',
    stateInput: 'customer-apply-state-input',
    pincodeInput: 'customer-apply-pincode-input',
    emiPreview: 'customer-apply-emi-preview',
    back: 'customer-apply-back-btn',
    next: 'customer-apply-next-btn',
    submit: 'customer-loan-application-submit-btn',
  },

  customerApplications: {
    root: 'customer-applications-page',
    table: 'customer-applications-table',
    row: 'customer-applications', // + -row-{id}
    newApplication: 'customer-applications-new-btn',
    statusFilter: 'customer-applications-status-filter',
    empty: 'customer-applications-empty-state',
  },

  applicationDetail: {
    root: 'customer-application-detail-page',
    number: 'customer-application-detail-number',
    status: 'customer-application-detail-status',
    stepper: 'customer-application-detail-stepper',
    summary: 'customer-application-detail-summary',
    timeline: 'customer-application-detail-timeline',
    withdraw: 'customer-application-withdraw-btn',
    remarks: 'customer-application-detail-remarks',

    // KYC step
    kycSection: 'customer-application-kyc-section',
    panInput: 'customer-application-kyc-pan-input',
    aadhaarInput: 'customer-application-kyc-aadhaar-input',
    kycSubmit: 'customer-application-kyc-submit-btn',
    kycStatus: 'customer-application-kyc-status',

    // Documents step
    documentsSection: 'customer-application-documents-section',
    documentTypeSelect: 'customer-application-document-type-select',
    documentFileInput: 'customer-application-document-file-input',
    documentCapture: 'customer-application-document-capture-btn',
    documentUpload: 'customer-application-document-upload-btn',
    documentsTable: 'customer-application-documents-table',
    documentRow: 'customer-application-documents', // + -row-{id}

    // Bureau step
    bureauSection: 'customer-application-bureau-section',
    bureauRun: 'customer-application-bureau-run-btn',
    bureauSimulate: 'customer-application-bureau-simulate-select',
    bureauScore: 'customer-application-bureau-score',
    bureauBand: 'customer-application-bureau-band',
    bureauSummary: 'customer-application-bureau-summary',

    // Offer step
    offerSection: 'customer-application-offer-section',
    offerAmount: 'customer-application-offer-amount',
    offerRoi: 'customer-application-offer-roi',
    offerTenure: 'customer-application-offer-tenure',
    offerEmi: 'customer-application-offer-emi',
    offerFee: 'customer-application-offer-fee',
    offerAccept: 'customer-application-offer-accept-btn',

    // e-sign step
    esignSection: 'customer-application-esign-section',
    esignRequestOtp: 'customer-application-esign-request-otp-btn',
    esignOtpInput: 'customer-application-esign-otp-input',
    esignSubmit: 'customer-application-esign-submit-btn',
    esignConsent: 'customer-application-esign-consent-checkbox',
    esignHint: 'customer-application-esign-otp-hint',

    // Payout account
    bankSection: 'customer-application-bank-section',
    bankHolderInput: 'customer-application-bank-holder-input',
    bankAccountInput: 'customer-application-bank-account-input',
    bankIfscInput: 'customer-application-bank-ifsc-input',
    bankSubmit: 'customer-application-bank-submit-btn',
    bankVerified: 'customer-application-bank-verified',

    rejected: 'customer-application-rejected-notice',
    awaitingDisbursement: 'customer-application-awaiting-disbursement',
  },

  customerLoans: {
    root: 'customer-loans-page',
    table: 'customer-loans-table',
    row: 'customer-loans',
    empty: 'customer-loans-empty-state',
  },

  loanDetail: {
    root: 'customer-loan-detail-page',
    number: 'customer-loan-detail-number',
    status: 'customer-loan-detail-status',
    outstandingCard: 'customer-loan-detail-outstanding-card',
    emiCard: 'customer-loan-detail-emi-card',
    nextDueCard: 'customer-loan-detail-next-due-card',
    overdueCard: 'customer-loan-detail-overdue-card',
    progress: 'customer-loan-detail-progress',

    tabSchedule: 'customer-loan-detail-tab-schedule',
    tabPayments: 'customer-loan-detail-tab-payments',
    tabTimeline: 'customer-loan-detail-tab-timeline',

    scheduleTable: 'customer-loan-schedule-table',
    scheduleRow: 'customer-loan-schedule', // + -row-{installmentNo}
    paymentsTable: 'customer-loan-payments-table',
    paymentRow: 'customer-loan-payments',

    payNow: 'customer-loan-pay-now-btn',
    partPayment: 'customer-loan-part-payment-btn',
    foreclose: 'customer-loan-foreclose-btn',
    downloadSchedule: 'customer-loan-download-schedule-btn',
    downloadStatement: 'customer-loan-download-statement-btn',
    downloadNoc: 'customer-loan-download-noc-btn',

    payModal: 'customer-loan-pay-modal',
    payAmountInput: 'customer-loan-pay-amount-input',
    payTypeSelect: 'customer-loan-pay-type-select',
    payConfirm: 'customer-loan-pay-confirm-btn',
    payCancel: 'customer-loan-pay-cancel-btn',
    payResult: 'customer-loan-pay-result',

    foreclosureModal: 'customer-loan-foreclosure-modal',
    foreclosureTotal: 'customer-loan-foreclosure-total',
    foreclosureConfirm: 'customer-loan-foreclosure-confirm-btn',
  },

  customerPayments: {
    root: 'customer-payments-page',
    table: 'customer-payments-table',
    row: 'customer-payments',
    empty: 'customer-payments-empty-state',
  },

  profile: {
    root: 'shared-profile-page',
    nameInput: 'shared-profile-name-input',
    mobileInput: 'shared-profile-mobile-input',
    save: 'shared-profile-save-btn',
    currentPasswordInput: 'shared-profile-current-password-input',
    newPasswordInput: 'shared-profile-new-password-input',
    changePassword: 'shared-profile-change-password-btn',
  },

  /* ---------------- Admin portal ---------------- */
  adminDashboard: {
    root: 'admin-dashboard-page',
    lifecycle: 'admin-dashboard-lifecycle',
    healthGauge: 'admin-dashboard-health-gauge',
    kpiApplications: 'admin-dashboard-kpi-total-applications',
    kpiPending: 'admin-dashboard-kpi-pending-review',
    kpiApproved: 'admin-dashboard-kpi-approved',
    kpiRejected: 'admin-dashboard-kpi-rejected',
    kpiDisbursed: 'admin-dashboard-kpi-disbursed',
    kpiDisbursedAmount: 'admin-dashboard-kpi-disbursed-amount',
    kpiActiveLoans: 'admin-dashboard-kpi-active-loans',
    kpiOverdue: 'admin-dashboard-kpi-overdue-accounts',
    kpiUsers: 'admin-dashboard-kpi-total-users',
    kpiBanks: 'admin-dashboard-kpi-total-banks',
    trendChart: 'admin-dashboard-trend-chart',
    statusChart: 'admin-dashboard-status-chart',
    bucketChart: 'admin-dashboard-bucket-chart',
    activityFeed: 'admin-dashboard-activity-feed',
    activityItem: 'admin-dashboard-activity-item',
  },

  adminApplications: {
    root: 'admin-applications-page',
    table: 'admin-applications-table',
    row: 'admin-applications', // + -row-{id}
    searchInput: 'admin-applications-search-input',
    statusFilter: 'admin-applications-status-filter',
    empty: 'admin-applications-empty-state',
    refresh: 'admin-applications-refresh-btn',
    liveBadge: 'admin-applications-live-badge',
  },

  adminReview: {
    root: 'admin-application-review-page',
    number: 'admin-application-review-number',
    status: 'admin-application-review-status',
    applicantPanel: 'admin-application-review-applicant',
    employmentPanel: 'admin-application-review-employment',
    obligationsPanel: 'admin-application-review-obligations',
    foir: 'admin-application-review-foir',
    bureauPanel: 'admin-application-review-bureau',
    bureauScore: 'admin-application-review-bureau-score',
    documentsPanel: 'admin-application-review-documents',
    documentRow: 'admin-application-review-documents',
    documentView: 'admin-application-review-document-view',
    documentVerify: 'admin-application-review-document-verify-btn',
    documentReject: 'admin-application-review-document-reject-btn',
    timeline: 'admin-application-review-timeline',
    decisionsPanel: 'admin-application-review-decisions',

    approve: 'admin-underwriting-approve-btn',
    reject: 'admin-underwriting-reject-btn',
    sendBack: 'admin-underwriting-send-back-btn',
    decisionModal: 'admin-underwriting-decision-modal',
    remarksInput: 'admin-underwriting-remarks-input',
    approvedAmountInput: 'admin-underwriting-approved-amount-input',
    roiInput: 'admin-underwriting-roi-input',
    tenureInput: 'admin-underwriting-tenure-input',
    decisionConfirm: 'admin-underwriting-decision-confirm-btn',
    decisionCancel: 'admin-underwriting-decision-cancel-btn',

    disburse: 'admin-disbursement-disburse-btn',
    disburseModal: 'admin-disbursement-modal',
    disburseBankSelect: 'admin-disbursement-bank-select',
    disburseConfirm: 'admin-disbursement-confirm-btn',
    disburseChecklist: 'admin-disbursement-checklist',
  },

  adminLoans: {
    root: 'admin-loans-page',
    table: 'admin-loans-table',
    row: 'admin-loans',
    searchInput: 'admin-loans-search-input',
    statusFilter: 'admin-loans-status-filter',
    empty: 'admin-loans-empty-state',
  },

  adminLoanDetail: {
    root: 'admin-loan-detail-page',
    number: 'admin-loan-detail-number',
    borrower: 'admin-loan-detail-borrower',
    recordPayment: 'admin-loan-record-payment-btn',
    paymentModal: 'admin-loan-record-payment-modal',
    paymentAmountInput: 'admin-loan-record-payment-amount-input',
    paymentTypeSelect: 'admin-loan-record-payment-type-select',
    paymentModeSelect: 'admin-loan-record-payment-mode-select',
    paymentNotesInput: 'admin-loan-record-payment-notes-input',
    paymentConfirm: 'admin-loan-record-payment-confirm-btn',
    scheduleTable: 'admin-loan-schedule-table',
    paymentsTable: 'admin-loan-payments-table',
  },

  adminCollections: {
    lifecycle: 'admin-collections-lifecycle',
    root: 'admin-collections-page',
    overview: 'admin-collections-overview',
    totalOverdue: 'admin-collections-total-overdue',
    delinquentCount: 'admin-collections-delinquent-count',
    bucketChart: 'admin-collections-bucket-chart',
    bucketFilter: 'admin-collections-bucket-filter',
    table: 'admin-collections-table',
    row: 'admin-collections',
    selectAll: 'admin-collections-select-all-checkbox',
    sendReminders: 'admin-collections-send-reminders-btn',
    addNote: 'admin-collections-add-note-btn',
    noteModal: 'admin-collections-note-modal',
    noteTypeSelect: 'admin-collections-note-type-select',
    noteOutcomeSelect: 'admin-collections-note-outcome-select',
    noteTextInput: 'admin-collections-note-text-input',
    noteFollowUpInput: 'admin-collections-note-follow-up-input',
    noteSubmit: 'admin-collections-note-submit-btn',
    notesList: 'admin-collections-notes-list',
    empty: 'admin-collections-empty-state',
  },

  adminUsers: {
    root: 'admin-users-page',
    table: 'admin-users-table',
    row: 'admin-users', // + -row-{id}
    addUser: 'admin-users-add-user-btn',
    searchInput: 'admin-users-search-input',
    roleFilter: 'admin-users-role-filter',
    modal: 'admin-users-modal',
    nameInput: 'admin-users-name-input',
    emailInput: 'admin-users-email-input',
    mobileInput: 'admin-users-mobile-input',
    passwordInput: 'admin-users-password-input',
    roleSelect: 'admin-users-role-select',
    statusSelect: 'admin-users-status-select',
    submit: 'admin-users-submit-btn',
    cancel: 'admin-users-cancel-btn',
    empty: 'admin-users-empty-state',
    tempPassword: 'admin-users-temp-password',
  },

  adminBanks: {
    root: 'admin-banks-page',
    table: 'admin-banks-table',
    row: 'admin-banks', // + -row-{id}
    addBank: 'admin-banks-add-bank-btn',
    searchInput: 'admin-banks-search-input',
    typeFilter: 'admin-banks-type-filter',
    modal: 'admin-banks-modal',
    nameInput: 'admin-banks-name-input',
    codeInput: 'admin-banks-code-input',
    typeSelect: 'admin-banks-type-select',
    accountNameInput: 'admin-banks-account-name-input',
    accountNumberInput: 'admin-banks-account-number-input',
    ifscInput: 'admin-banks-ifsc-input',
    branchInput: 'admin-banks-branch-input',
    statusSelect: 'admin-banks-status-select',
    submit: 'admin-banks-submit-btn',
    cancel: 'admin-banks-cancel-btn',
    empty: 'admin-banks-empty-state',
  },

  adminSettings: {
    root: 'admin-settings-page',
    tabProduct: 'admin-settings-tab-product',
    tabUnderwriting: 'admin-settings-tab-underwriting',

    minAmountInput: 'admin-settings-min-amount-input',
    maxAmountInput: 'admin-settings-max-amount-input',
    minTenureInput: 'admin-settings-min-tenure-input',
    maxTenureInput: 'admin-settings-max-tenure-input',
    minRoiInput: 'admin-settings-min-roi-input',
    maxRoiInput: 'admin-settings-max-roi-input',
    processingFeeInput: 'admin-settings-processing-fee-input',
    latePenaltyInput: 'admin-settings-late-penalty-input',
    foreclosureChargeInput: 'admin-settings-foreclosure-charge-input',
    saveProduct: 'admin-settings-save-product-btn',

    minScoreInput: 'admin-settings-min-score-input',
    autoApproveScoreInput: 'admin-settings-auto-approve-score-input',
    maxDtiInput: 'admin-settings-max-dti-input',
    minIncomeInput: 'admin-settings-min-income-input',
    blacklistInput: 'admin-settings-blacklist-input',
    saveUnderwriting: 'admin-settings-save-underwriting-btn',
  },

  adminAudit: {
    root: 'admin-audit-page',
    table: 'admin-audit-table',
    row: 'admin-audit',
    searchInput: 'admin-audit-search-input',
    empty: 'admin-audit-empty-state',
  },

  adminDocuments: {
    root: 'admin-documents-page',
    table: 'admin-documents-table',
    row: 'admin-documents',
    verify: 'admin-documents-verify-btn',
    reject: 'admin-documents-reject-btn',
    empty: 'admin-documents-empty-state',
  },
};

/**
 * Navigation keys. Each renders twice — once in the desktop sidebar
 * (`sidebar-nav-<key>`) and once in the mobile drawer (`mobile-nav-<key>`).
 */
export const NAV_KEYS = {
  customer: ['dashboard', 'apply-loan', 'applications', 'loans', 'payments', 'eligibility', 'profile'],
  admin: [
    'dashboard',
    'applications',
    'documents',
    'loans',
    'collections',
    'users',
    'banks',
    'settings',
    'audit',
    'profile',
  ],
};

export default TESTIDS;
