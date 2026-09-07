/**
 * New loan application — a three-part form (loan, employment, personal) with a
 * live EMI preview.
 *
 * On submit the application goes straight into the underwriting pipeline and the
 * customer is taken to its detail page to continue with KYC.
 */
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Send, Info } from 'lucide-react';
import { TESTIDS } from '@shared/testIds.js';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Card, CardHeader, CardBody, CardFooter } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { FormError, LoadingState } from '../../components/ui/States.jsx';
import { Stepper } from '../../components/ui/Stepper.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { http } from '../../lib/api.js';
import { currency, calculateEmi } from '../../lib/format.js';
import { EMPLOYMENT_TYPES, LOAN_PURPOSES } from '../../lib/constants.js';
import { fieldErrorsOf } from '../../lib/utils.js';

const SECTIONS = [
  { key: 'loan', label: 'Loan details' },
  { key: 'employment', label: 'Employment' },
  { key: 'personal', label: 'Personal details' },
];

export default function ApplyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Values carried over from the eligibility calculator, when the user came from there.
  const prefill = location.state ?? {};

  const { data: productData, isLoading: productLoading } = useQuery({
    queryKey: ['product'],
    queryFn: () => http.get('/product'),
    staleTime: 5 * 60_000,
  });

  const product = productData?.product;

  const [section, setSection] = useState(0);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    amountRequested: prefill.amount ? String(prefill.amount) : '',
    tenureRequested: prefill.tenure ? String(prefill.tenure) : '36',
    purpose: '',
    purposeNote: '',
    employmentType: prefill.employmentType ?? 'salaried',
    employerName: '',
    monthlyIncome: prefill.monthlyIncome ? String(prefill.monthlyIncome) : '',
    existingEmi: prefill.existingEmi !== undefined ? String(prefill.existingEmi) : '0',
    experienceYears: '',
    fullName: user?.name ?? '',
    dob: '',
    gender: '',
    addressLine1: '',
    city: '',
    state: '',
    pincode: '',
  });

  const set = (field) => (event) => {
    const value = field === 'pincode' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  /** Indicative EMI at the mid-point rate; the binding figure comes from the offer. */
  const previewEmi = useMemo(() => {
    if (!product) return null;
    const amount = Number(form.amountRequested);
    const tenure = Number(form.tenureRequested);
    if (!(amount > 0) || !(tenure > 0)) return null;
    const midRoi = (product.minRoi + product.maxRoi) / 2;
    return { emi: calculateEmi(amount, midRoi, tenure), roi: midRoi };
  }, [form.amountRequested, form.tenureRequested, product]);

  const validateSection = (index) => {
    const next = {};

    if (index === 0) {
      const amount = Number(form.amountRequested);
      if (!(amount > 0)) next.amountRequested = 'Enter the amount you need.';
      else if (product && (amount < product.minAmount || amount > product.maxAmount)) {
        next.amountRequested = `Must be between ${currency(product.minAmount)} and ${currency(product.maxAmount)}.`;
      }

      const tenure = Number(form.tenureRequested);
      if (!(tenure > 0)) next.tenureRequested = 'Select a tenure.';
      else if (product && (tenure < product.minTenureMonths || tenure > product.maxTenureMonths)) {
        next.tenureRequested = `Must be between ${product.minTenureMonths} and ${product.maxTenureMonths} months.`;
      }

      if (!form.purpose) next.purpose = 'Select the purpose of the loan.';
    }

    if (index === 1) {
      if (!form.employmentType) next.employmentType = 'Select your employment type.';
      const income = Number(form.monthlyIncome);
      if (!(income > 0)) next.monthlyIncome = 'Enter your monthly income.';
      const emi = Number(form.existingEmi || 0);
      if (emi < 0) next.existingEmi = 'Cannot be negative.';
      else if (income > 0 && emi >= income) next.existingEmi = 'Existing EMI cannot exceed your income.';
    }

    if (index === 2) {
      if (form.fullName.trim().length < 2) next.fullName = 'Enter your full name.';
      if (form.pincode && !/^\d{6}$/.test(form.pincode)) next.pincode = 'Enter a valid 6-digit pincode.';
      if (form.dob) {
        const age = (Date.now() - new Date(form.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (age < 18) next.dob = 'You must be at least 18 years old to apply.';
        if (age > 100) next.dob = 'Enter a valid date of birth.';
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submitApplication = useMutation({
    mutationFn: (payload) => http.post('/applications', payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(
        'Application submitted',
        `${data.application.applicationNo} is now with our team. Complete your KYC to continue.`
      );
      navigate(`/app/applications/${data.application._id}`, { replace: true });
    },
    onError: (err) => {
      setError(err.message);
      const fields = fieldErrorsOf(err);
      setErrors(fields);
      // Jump back to the section that owns the rejected field.
      if (fields.amountRequested || fields.tenureRequested || fields.purpose) setSection(0);
      else if (fields.employment || fields.monthlyIncome) setSection(1);
    },
  });

  const next = () => {
    if (!validateSection(section)) return;
    setSection((current) => Math.min(SECTIONS.length - 1, current + 1));
  };

  const back = () => setSection((current) => Math.max(0, current - 1));

  const isLast = section === SECTIONS.length - 1;

  const submit = (event) => {
    event.preventDefault();

    // Only the last section may submit. Without this, pressing Enter in any
    // earlier section would file the application with the remaining sections
    // left at their defaults.
    if (!isLast) return;

    setError('');

    // Re-validate every section, not just the visible one.
    for (let index = 0; index < SECTIONS.length; index += 1) {
      if (!validateSection(index)) {
        setSection(index);
        return;
      }
    }

    submitApplication.mutate({
      amountRequested: Number(form.amountRequested),
      tenureRequested: Number(form.tenureRequested),
      purpose: form.purpose,
      purposeNote: form.purposeNote,
      employment: {
        type: form.employmentType,
        employerName: form.employerName,
        monthlyIncome: Number(form.monthlyIncome),
        existingEmi: Number(form.existingEmi || 0),
        experienceYears: Number(form.experienceYears || 0),
      },
      personal: {
        fullName: form.fullName.trim(),
        ...(form.dob ? { dob: form.dob } : {}),
        ...(form.gender ? { gender: form.gender } : {}),
        addressLine1: form.addressLine1,
        city: form.city,
        state: form.state,
        ...(form.pincode ? { pincode: form.pincode } : {}),
      },
      submit: true,
    });
  };

  if (productLoading) return <LoadingState label="Loading product details…" />;

  return (
    <div data-testid={TESTIDS.apply.root}>
      <PageHeader
        title="Apply for a personal loan"
        subtitle="Three short sections. You will complete KYC and upload documents once this is submitted."
      />

      <Card>
        <CardBody className="border-b border-slate-200">
          <Stepper current={SECTIONS[section].key} steps={SECTIONS} testId={TESTIDS.apply.stepper} />
        </CardBody>

        <form onSubmit={submit} noValidate>
          <CardBody className="space-y-5">
            {error ? <FormError message={error} /> : null}

            {/* ---------------- Loan details ---------------- */}
            {section === 0 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Loan amount"
                    name="amountRequested"
                    type="number"
                    inputMode="numeric"
                    prefix="₹"
                    min={product?.minAmount}
                    max={product?.maxAmount}
                    placeholder="400000"
                    value={form.amountRequested}
                    onChange={set('amountRequested')}
                    error={errors.amountRequested}
                    hint={
                      product
                        ? `${currency(product.minAmount)} – ${currency(product.maxAmount)}`
                        : undefined
                    }
                    testId={TESTIDS.apply.amountInput}
                    required
                  />
                  <Input
                    label="Tenure (months)"
                    name="tenureRequested"
                    type="number"
                    inputMode="numeric"
                    min={product?.minTenureMonths}
                    max={product?.maxTenureMonths}
                    value={form.tenureRequested}
                    onChange={set('tenureRequested')}
                    error={errors.tenureRequested}
                    hint={
                      product
                        ? `${product.minTenureMonths} – ${product.maxTenureMonths} months`
                        : undefined
                    }
                    testId={TESTIDS.apply.tenureInput}
                    required
                  />
                </div>

                <Select
                  label="Purpose of the loan"
                  name="purpose"
                  value={form.purpose}
                  onChange={set('purpose')}
                  options={LOAN_PURPOSES}
                  placeholder="Select a purpose"
                  error={errors.purpose}
                  testId={TESTIDS.apply.purposeSelect}
                  required
                />

                <Textarea
                  label="Anything else we should know? (optional)"
                  name="purposeNote"
                  rows={2}
                  maxLength={300}
                  placeholder="A short note about what the funds are for."
                  value={form.purposeNote}
                  onChange={set('purposeNote')}
                  testId={TESTIDS.apply.purposeNoteInput}
                />

                {previewEmi ? (
                  <div
                    data-testid={TESTIDS.apply.emiPreview}
                    className="flex flex-col gap-2 rounded-card border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-brand-300">
                        Indicative EMI
                      </p>
                      <p className="mt-0.5 text-2xl font-semibold text-brand-800">
                        {currency(previewEmi.emi, { decimals: 2 })}
                        <span className="ml-1 text-sm font-normal text-brand-400">/ month</span>
                      </p>
                    </div>
                    <p className="flex items-start gap-1.5 text-xs text-brand-300 sm:max-w-[16rem]">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      At {previewEmi.roi}% p.a. Your actual rate depends on your credit assessment.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ---------------- Employment ---------------- */}
            {section === 1 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Employment type"
                    name="employmentType"
                    value={form.employmentType}
                    onChange={set('employmentType')}
                    options={EMPLOYMENT_TYPES}
                    error={errors.employmentType}
                    testId={TESTIDS.apply.employmentTypeSelect}
                    required
                  />
                  <Input
                    label="Employer / business name"
                    name="employerName"
                    placeholder="Sedin Technologies"
                    value={form.employerName}
                    onChange={set('employerName')}
                    error={errors.employerName}
                    testId={TESTIDS.apply.employerInput}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Monthly income (take-home)"
                    name="monthlyIncome"
                    type="number"
                    inputMode="numeric"
                    prefix="₹"
                    min="0"
                    placeholder="75000"
                    value={form.monthlyIncome}
                    onChange={set('monthlyIncome')}
                    error={errors.monthlyIncome}
                    testId={TESTIDS.apply.incomeInput}
                    required
                  />
                  <Input
                    label="Existing monthly EMI obligations"
                    name="existingEmi"
                    type="number"
                    inputMode="numeric"
                    prefix="₹"
                    min="0"
                    placeholder="0"
                    value={form.existingEmi}
                    onChange={set('existingEmi')}
                    error={errors.existingEmi}
                    hint="Enter 0 if you have no other loans."
                    testId={TESTIDS.apply.existingEmiInput}
                  />
                </div>

                <Input
                  label="Years of experience"
                  name="experienceYears"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="60"
                  placeholder="5"
                  value={form.experienceYears}
                  onChange={set('experienceYears')}
                  error={errors.experienceYears}
                  className="sm:max-w-xs"
                  testId={TESTIDS.apply.experienceInput}
                />
              </div>
            ) : null}

            {/* ---------------- Personal ---------------- */}
            {section === 2 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Full name (as on PAN)"
                    name="fullName"
                    value={form.fullName}
                    onChange={set('fullName')}
                    error={errors.fullName}
                    testId={TESTIDS.apply.fullNameInput}
                    required
                  />
                  <Input
                    label="Date of birth"
                    name="dob"
                    type="date"
                    value={form.dob}
                    onChange={set('dob')}
                    error={errors.dob}
                    testId={TESTIDS.apply.dobInput}
                  />
                </div>

                <Select
                  label="Gender"
                  name="gender"
                  value={form.gender}
                  onChange={set('gender')}
                  placeholder="Prefer not to say"
                  options={[
                    { value: 'male', label: 'Male' },
                    { value: 'female', label: 'Female' },
                    { value: 'other', label: 'Other' },
                  ]}
                  className="sm:max-w-xs"
                  testId={TESTIDS.apply.genderSelect}
                />

                <Input
                  label="Address"
                  name="addressLine1"
                  placeholder="Flat / street / area"
                  value={form.addressLine1}
                  onChange={set('addressLine1')}
                  error={errors.addressLine1}
                  testId={TESTIDS.apply.address1Input}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="City"
                    name="city"
                    value={form.city}
                    onChange={set('city')}
                    error={errors.city}
                    testId={TESTIDS.apply.cityInput}
                  />
                  <Input
                    label="State"
                    name="state"
                    value={form.state}
                    onChange={set('state')}
                    error={errors.state}
                    testId={TESTIDS.apply.stateInput}
                  />
                  <Input
                    label="Pincode"
                    name="pincode"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.pincode}
                    onChange={set('pincode')}
                    error={errors.pincode}
                    testId={TESTIDS.apply.pincodeInput}
                  />
                </div>

                <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  Demonstration environment — please do not enter real personal details. All
                  verification is simulated.
                </p>
              </div>
            ) : null}
          </CardBody>

          <CardFooter className="action-bar justify-between">
            <Button
              variant="secondary"
              icon={ArrowLeft}
              onClick={section === 0 ? () => navigate('/app') : back}
              data-testid={TESTIDS.apply.back}
            >
              {section === 0 ? 'Cancel' : 'Back'}
            </Button>

            {/*
              The distinct `key`s matter: without them React reuses this one
              DOM node and only patches `type` from "button" to "submit". That
              patch lands mid-click, so the browser's activation behaviour then
              submits the form from the "Continue" button that was just clicked.
            */}
            {isLast ? (
              <Button
                key="submit"
                type="submit"
                variant="cta"
                icon={Send}
                loading={submitApplication.isPending}
                data-testid={TESTIDS.apply.submit}
              >
                Submit application
              </Button>
            ) : (
              <Button
                key="next"
                icon={ArrowRight}
                iconRight
                onClick={next}
                data-testid={TESTIDS.apply.next}
              >
                Continue
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
