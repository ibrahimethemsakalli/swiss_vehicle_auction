import { db } from './db';
import { rateLimit } from './rate-limit';
import { localMessagesEnabled, issueChallenge, consumeChallenge } from './account-challenges';
import { twilioTransport } from './twilio-transport';
export interface SmsGateway {
  send(phone: string, language: string): Promise<string>;
  check(sid: string, code: string): Promise<boolean>;
}
function realSms() {
  return twilioTransport({
    account: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    service: process.env.TWILIO_VERIFY_SERVICE_SID,
  });
}
export const smsGateway: SmsGateway = {
  async send(phone, language) {
    if (process.env.LOCAL_TEST_MESSAGES === 'true' && !localMessagesEnabled())
      throw new Error('PROVIDER_UNAVAILABLE');
    if (localMessagesEnabled()) {
      const user = await db.user.findUniqueOrThrow({ where: { phone } });
      return issueChallenge(user.id, 'SMS', phone);
    }
    return realSms().send(phone, language);
  },
  async check(sid, code) {
    if (process.env.LOCAL_TEST_MESSAGES === 'true' && !localMessagesEnabled())
      throw new Error('PROVIDER_UNAVAILABLE');
    if (localMessagesEnabled()) {
      const rows = await db.$queryRaw<
        { userId: string }[]
      >`SELECT "userId" FROM "AccountChallenge" WHERE id=${sid} AND purpose='SMS'`;
      if (!rows[0]) return false;
      try {
        await consumeChallenge(rows[0].userId, 'SMS', code);
        return true;
      } catch {
        return false;
      }
    }
    return realSms().check(sid, code);
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
