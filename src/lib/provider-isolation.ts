/** Fail closed: requesting simulation must never silently select a real provider. */
export function paymentRoute(
  mode: { requested: boolean; enabled: boolean },
  id?: string,
  storedGateway?: string,
): 'local' | 'stripe' {
  if (mode.requested && !mode.enabled) throw new Error('PROVIDER_UNAVAILABLE');
  const localId = id?.startsWith('local_');
  if (mode.enabled) {
    if ((id && !localId) || (storedGateway && storedGateway !== 'local-test'))
      throw new Error('FORBIDDEN');
    return 'local';
  }
  if (localId || storedGateway === 'local-test') throw new Error('FORBIDDEN');
  return 'stripe';
}

export function assertRealSmsId(id: string) {
  if (!/^VE[0-9a-f]{32}$/i.test(id)) throw new Error('VERIFICATION_FAILED');
}
