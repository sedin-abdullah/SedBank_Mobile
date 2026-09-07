/**
 * Sign in — email/password, or mobile OTP.
 *
 * The OTP is mocked: the API returns it in `devCode` outside production, and it
 * is shown in a clearly-labelled demo hint so the flow can be completed (and
 * automated) without an SMS vendor.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, Smartphone, KeyRound, ArrowLeft, Fingerprint } from 'lucide-react';
import { TESTIDS } from '@shared/testIds.js';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { FormError } from '../../components/ui/States.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { http } from '../../lib/api.js';
import { DEMO_ACCOUNTS, isStaff } from '../../lib/constants.js';
import { fieldErrorsOf, cn } from '../../lib/utils.js';
import {
  IS_NATIVE,
  biometricAvailability,
  hasBiometricCredentials,
  enrolBiometric,
  biometricSignIn,
} from '../../lib/native.js';

const SHOW_DEMO = import.meta.env.VITE_SHOW_DEMO_LOGINS !== 'false';

const DEMO_TESTIDS = {
  admin: TESTIDS.login.demoAdmin,
  customer: TESTIDS.login.demoCustomer,
  credit_officer: TESTIDS.login.demoCredit,
  ops_officer: TESTIDS.login.demoOps,
  collections_officer: TESTIDS.login.demoCollections,
};

export default function LoginPage() {
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState('password'); // password | otp
  const [form, setForm] = useState({ email: '', password: '' });
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Biometric sign-in is offered only once the device supports it AND the
   * user has already signed in with a password at least once — there is
   * nothing to unlock before that.
   */
  const [biometric, setBiometric] = useState({ available: false, enrolled: false, kind: '' });

  useEffect(() => {
    if (!IS_NATIVE) return;
    let cancelled = false;
    (async () => {
      const info = await biometricAvailability();
      const enrolled = info ? await hasBiometricCredentials() : false;
      if (cancelled) return;
      setBiometric({
        available: !!info,
        enrolled,
        kind: info?.biometryType === 2 ? 'Face' : 'Fingerprint',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goHome = (user) => navigate(isStaff(user.role) ? '/admin' : '/app', { replace: true });

  /** Client-side checks mirror the server's, purely for faster feedback. */
  const validatePassword = () => {
    const next = {};
    if (!form.email.trim()) next.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address.';
    if (!form.password) next.password = 'Enter your password.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setError('');
    if (!validatePassword()) return;

    setBusy(true);
    try {
      const user = await login({ email: form.email.trim().toLowerCase(), password: form.password });

      // Enrol silently once the password has proved itself. The credentials
      // go into the device keystore, never into app storage.
      if (biometric.available && !biometric.enrolled) {
        try {
          await enrolBiometric({
            email: form.email.trim().toLowerCase(),
            password: form.password,
          });
        } catch {
          /* enrolment is a convenience; never block sign-in on it */
        }
      }

      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      goHome(user);
    } catch (err) {
      setError(err.message);
      setErrors(fieldErrorsOf(err));
    } finally {
      setBusy(false);
    }
  };

  const requestOtp = async (event) => {
    event.preventDefault();
    setError('');

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrors({ mobile: 'Enter a valid 10-digit mobile number.' });
      return;
    }
    setErrors({});
    setBusy(true);

    try {
      const result = await http.post('/auth/otp/request', { mobile, purpose: 'login' });
      setOtpSent(true);
      setDevCode(result.devCode || '');
      toast.info('OTP sent', 'Check the demo hint below — no real SMS is sent.');
    } catch (err) {
      setError(err.message);
      setErrors(fieldErrorsOf(err));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (event) => {
    event.preventDefault();
    setError('');

    if (!/^\d{6}$/.test(otp)) {
      setErrors({ otp: 'Enter the 6-digit code.' });
      return;
    }
    setErrors({});
    setBusy(true);

    try {
      const user = await verifyOtp({ mobile, code: otp, purpose: 'login' });
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      goHome(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Fills the sign-in form with a demo role's credentials — deliberately does
   * NOT authenticate. Signing in stays an explicit act: the user still has to
   * press "Sign in". Keeps QA and reviewers out of the credentials file
   * without ever logging anyone in on a single stray click.
   */
  const fillDemoCredentials = (account) => {
    // The credentials only apply to the password form, so leave the OTP tab.
    setMode('password');
    setError('');
    setErrors({});
    setForm({ email: account.email, password: account.password });
  };

  const signInWithBiometric = async () => {
    setError('');
    const credentials = await biometricSignIn();
    if (!credentials) return; // cancelled or not recognised — not an error

    setBusy(true);
    try {
      const user = await login(credentials);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      goHome(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setErrors({});
  };

  return (
    <AuthLayout
      title="Sign in to SedBank"
      subtitle="Access your loan dashboard or the operations portal."
      footer={
        <>
          New to SedBank?{' '}
          <Link to="/register" data-testid={TESTIDS.login.toRegister} className="link">
            Create an account
          </Link>
        </>
      }
    >
      <div data-testid={TESTIDS.login.root}>
        {/* Method switch */}
        <div className="mb-6 inline-flex w-full rounded-lg border border-white/10 bg-white/[0.05] p-1 backdrop-blur-glass">
          <button
            type="button"
            data-testid={TESTIDS.login.tabPassword}
            onClick={() => switchMode('password')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
              mode === 'password'
                ? 'bg-white/[0.12] text-slate-900 shadow-card'
                : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <KeyRound className="h-4 w-4" />
            Password
          </button>
          <button
            type="button"
            data-testid={TESTIDS.login.tabOtp}
            onClick={() => switchMode('otp')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
              mode === 'otp'
                ? 'bg-white/[0.12] text-slate-900 shadow-card'
                : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Smartphone className="h-4 w-4" />
            Mobile OTP
          </button>
        </div>

        {error ? (
          <div className="mb-4" data-testid={TESTIDS.login.error}>
            <FormError message={error} />
          </div>
        ) : null}

        {biometric.available && biometric.enrolled ? (
          <div className="mb-5">
            <Button
              variant="secondary"
              fullWidth
              size="lg"
              icon={Fingerprint}
              disabled={busy}
              onClick={signInWithBiometric}
              data-testid={TESTIDS.login.biometric}
            >
              Sign in with {biometric.kind}
            </Button>
            <p className="mt-2 text-center text-xs text-slate-500">
              or use your {mode === 'password' ? 'password' : 'mobile number'} below
            </p>
          </div>
        ) : null}

        {mode === 'password' ? (
          <form onSubmit={submitPassword} className="space-y-4" noValidate>
            <Input
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              error={errors.email}
              testId={TESTIDS.login.emailInput}
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              error={errors.password}
              testId={TESTIDS.login.passwordInput}
              required
            />
            <Button
              type="submit"
              variant="cta"
              fullWidth
              size="lg"
              icon={LogIn}
              loading={busy}
              data-testid={TESTIDS.login.submit}
            >
              Sign in
            </Button>
          </form>
        ) : !otpSent ? (
          <form onSubmit={requestOtp} className="space-y-4" noValidate>
            <Input
              label="Mobile number"
              name="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="9876543210"
              maxLength={10}
              prefix="+91"
              value={mobile}
              onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 10))}
              error={errors.mobile}
              hint="We will send a 6-digit code. The SMS channel is simulated."
              testId={TESTIDS.login.mobileInput}
              required
            />
            <Button
              type="submit"
              variant="cta"
              fullWidth
              size="lg"
              loading={busy}
              data-testid={TESTIDS.login.requestOtp}
            >
              Send OTP
            </Button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-4" noValidate>
            <Input
              label={`Code sent to +91 ${mobile}`}
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              error={errors.otp}
              testId={TESTIDS.login.otpInput}
              required
            />

            {devCode ? (
              <p
                data-testid={TESTIDS.login.otpHint}
                data-otp={devCode}
                className="rounded-lg border border-warning-500/25 bg-warning-500/10 px-3 py-2 text-xs text-warning-700"
              >
                <span className="font-semibold">Demo environment:</span> your OTP is{' '}
                <span className="font-mono font-bold">{devCode}</span> — no SMS was sent.
              </p>
            ) : null}

            <Button
              type="submit"
              variant="cta"
              fullWidth
              size="lg"
              loading={busy}
              data-testid={TESTIDS.login.verifyOtp}
            >
              Verify and sign in
            </Button>
            <Button
              variant="ghost"
              fullWidth
              icon={ArrowLeft}
              onClick={() => {
                setOtpSent(false);
                setOtp('');
                setDevCode('');
              }}
            >
              Use a different number
            </Button>
          </form>
        )}

        {SHOW_DEMO ? (
          <div className="mt-8 rounded-card border border-dashed border-white/15 bg-white/[0.04] p-4 backdrop-blur-glass">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Demo accounts
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Test logins created by the seed script. Pick a role to fill the form, then press
              Sign in. All business data starts empty.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <Button
                  key={account.role}
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => fillDemoCredentials(account)}
                  title={`Fill the form with the ${account.label} demo credentials`}
                  data-testid={DEMO_TESTIDS[account.role]}
                >
                  {account.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
