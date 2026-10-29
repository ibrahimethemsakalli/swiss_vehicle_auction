const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function validSupportMessageId(value: string) {
  return uuid.test(value);
}
export function supportMessageHref(ticket: string, message: string, admin: boolean, lang: string) {
  if (!uuid.test(ticket) || !uuid.test(message)) throw Error('INVALID_MESSAGE_LINK');
  const params = new URLSearchParams({
    ticket: ticket.toLowerCase(),
    message: message.toLowerCase(),
  });
  if (['de', 'fr', 'it', 'en'].includes(lang)) params.set('lang', lang);
  return (admin ? '/admin/support' : '/support') + '?' + params;
}
