import { db } from './db';
import { rateLimit } from './rate-limit';
export interface SmsGateway {
  send(phone: string, language: string): Promise<string>;
  check(sid: string, code: string): Promise<boolean>;
}
async function twilio(path: string, body: URLSearchParams) {
  const {
    TWILIO_ACCOUNT_SID: account,
    TWILIO_AUTH_TOKEN: token,
    TWILIO_VERIFY_SERVICE_SID: service,
  } = process.env;
  if (!account || !token || !service) throw new Error('PROVIDER_UNAVAILABLE');
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('VERIFICATION_FAILED');
  return response.json();
}
export const smsGateway: SmsGateway = {
  async send(phone, language) {
    const result = await twilio(
      'Verifications',
      new URLSearchParams({ To: phone, Channel: 'sms', Locale: language }),
    );
    if (!/^VE[0-9a-f]{32}$/i.test(result.sid)) throw new Error('VERIFICATION_FAILED');
    return result.sid;
  },
  async check(sid, code) {
    const result = await twilio(
      'VerificationCheck',
      new URLSearchParams({ VerificationSid: sid, Code: code }),
    );
    return result.sid === sid && result.status === 'approved';
  },
};
export async function sendSms(userId: string, gateway: SmsGateway = smsGateway) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.suspendedAt || user.phoneVerifiedAt) throw new Error('FORBIDDEN');
  await rateLimit(`sms:minute:${userId}`, 1, 60);
  await rateLimit(`sms:day:${userId}`, 5, 86400);
  await rateLimit('sms:global', 100, 86400);
  const verificationSid = await gateway.send(user.phone, user.language);
  await db.smsVerification.upsert({
    where: { userId },
    create: { userId, verificationSid, expiresAt: new Date(Date.now() + 600000) },
    update: { verificationSid, expiresAt: new Date(Date.now() + 600000) },
  });
}
export async function checkSms(userId: string, code: string, gateway: SmsGateway = smsGateway) {
  if (!/^\d{4,10}$/.test(code)) throw new Error('VERIFICATION_FAILED');
  await rateLimit(`sms:check:${userId}`, 5, 600);
  const verification = await db.smsVerification.findUnique({ where: { userId } });
  if (
    !verification ||
    verification.expiresAt <= new Date() ||
    !(await gateway.check(verification.verificationSid, code))
  )
    throw new Error('VERIFICATION_FAILED');
  await db.$transaction(async (tx) => {
    const removed = await tx.smsVerification.deleteMany({
      where: {
        userId,
        verificationSid: verification.verificationSid,
        expiresAt: { gt: new Date() },
      },
    });
    if (removed.count !== 1) throw new Error('VERIFICATION_FAILED');
    const updated = await tx.user.updateMany({
      where: { id: userId, suspendedAt: null, phoneVerifiedAt: null },
      data: { phoneVerifiedAt: new Date() },
    });
    if (updated.count !== 1) throw new Error('VERIFICATION_FAILED');
  });
}
