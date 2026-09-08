/**
 * One-time codes for mobile signup/login and e-sign consent.
 *
 * The delivery channel is mocked (console + in-memory outbox), but the mechanics
 * are real: codes are hashed at rest, expire, are single-use, and are rate- and
 * attempt-limited. Outside production the code is echoed back in the response so
 * the Playwright suite can complete OTP flows without an SMS vendor.
 */
import crypto from 'node:crypto';
import Otp from '../models/Otp.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import messenger from '../mocks/messenger.js';

const MAX_ATTEMPTS = 5;
/** No more than this many codes may be requested per identifier+purpose per window. */
const MAX_SENDS_PER_WINDOW = 5;
const WINDOW_MINUTES = 15;

/**
 * A fixed code where the environment already gives it away.
 *
 * `EXPOSE_OTP` returns the code in the response, so on such a deployment the
 * code is not a secret and randomising it only makes automation read it back
 * from every response. A constant lets a test send `123456` and be done.
 * Everything else about the flow is unchanged — the code is still hashed at
 * rest, still expires, is still single-use and still rate-limited.
 *
 * When EXPOSE_OTP is off — any real deployment — the code stays random.
 */
const STATIC_CODE = '123456';

const generateCode = () =>
  env.exposeOtp ? STATIC_CODE : String(crypto.randomInt(100000, 1000000));

/**
 * Issues a code for an identifier (mobile number, or an application id for e-sign).
 * @returns {{sent:true, expiresAt:Date, devCode?:string}}
 */
export async function issueOtp({ identifier, purpose, deliverTo = null, subject = 'Your SedBank OTP' }) {
  const recentSends = await Otp.countDocuments({
    identifier,
    purpose,
    createdAt: { $gte: new Date(Date.now() - WINDOW_MINUTES * 60 * 1000) },
  });

  if (recentSends >= MAX_SENDS_PER_WINDOW) {
    throw new ApiError(429, `Too many OTP requests. Please try again in ${WINDOW_MINUTES} minutes.`);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

  // Any earlier unconsumed code for this identifier+purpose is invalidated.
  await Otp.updateMany(
    { identifier, purpose, consumedAt: null },
    { consumedAt: new Date(), attempts: MAX_ATTEMPTS }
  );

  await Otp.create({
    identifier,
    purpose,
    codeHash: await Otp.hashCode(code),
    expiresAt,
  });

  const message = `Your SedBank verification code is ${code}. It expires in ${env.otpTtlMinutes} minutes. (Demo environment — do not share.)`;

  if (deliverTo?.mobile) await messenger.sendSms({ to: deliverTo.mobile, message });
  if (deliverTo?.email) await messenger.sendEmail({ to: deliverTo.email, subject, text: message });
  if (!deliverTo) await messenger.sendSms({ to: identifier, message });

  return {
    sent: true,
    expiresAt,
    // Echoed only in non-production so automated tests can proceed.
    ...(env.exposeOtp ? { devCode: code } : {}),
  };
}

/**
 * Verifies and consumes a code. Throws an ApiError on any failure so callers
 * can surface the exact reason to the user.
 */
export async function verifyOtp({ identifier, purpose, code }) {
  const record = await Otp.findOne({ identifier, purpose, consumedAt: null }).sort({ createdAt: -1 });

  if (!record) throw ApiError.badRequest('No active code found. Please request a new OTP.');
  if (record.expiresAt < new Date()) {
    throw ApiError.badRequest('This code has expired. Please request a new OTP.');
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    throw ApiError.badRequest('Too many incorrect attempts. Please request a new OTP.');
  }

  const matches = await record.matches(code);
  if (!matches) {
    record.attempts += 1;
    await record.save();
    const left = Math.max(0, MAX_ATTEMPTS - record.attempts);
    throw ApiError.badRequest(`Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`);
  }

  record.consumedAt = new Date();
  await record.save();
  return true;
}

export default { issueOtp, verifyOtp };
