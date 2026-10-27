import { assertRealSmsId } from './provider-isolation';

export function twilioTransport(
  config: { account?: string; token?: string; service?: string },
  request: typeof fetch = fetch,
) {
  async function post(path: string, body: URLSearchParams) {
    const { account, token, service } = config;
    if (!account || !token || !service) throw new Error('PROVIDER_UNAVAILABLE');
    let response: Response;
    try {
      response = await request(
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
    } catch {
      throw new Error('PROVIDER_UNAVAILABLE');
    }
    if (response.status === 429 || response.status >= 500) throw new Error('PROVIDER_UNAVAILABLE');
    if (!response.ok) throw new Error('VERIFICATION_FAILED');
    try {
      return await response.json();
    } catch {
      throw new Error('PROVIDER_UNAVAILABLE');
    }
  }
  return {
    async send(phone: string, language: string): Promise<string> {
      const result = await post(
        'Verifications',
        new URLSearchParams({ To: phone, Channel: 'sms', Locale: language }),
      );
      if (
        !result ||
        typeof result.sid !== 'string' ||
        result.status !== 'pending' ||
        result.to !== phone ||
        result.channel !== 'sms'
      )
        throw new Error('VERIFICATION_FAILED');
      assertRealSmsId(result.sid);
      return result.sid;
    },
    async check(sid: string, code: string): Promise<boolean> {
      assertRealSmsId(sid);
      if (!/^\d{4,10}$/.test(code)) throw new Error('VERIFICATION_FAILED');
      const result = await post(
        'VerificationCheck',
        new URLSearchParams({ VerificationSid: sid, Code: code }),
      );
      return result?.sid === sid && result?.status === 'approved';
    },
  };
}
