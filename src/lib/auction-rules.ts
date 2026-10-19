export function auctionEndAfterBid(end: Date, now: Date): Date {
  const remaining = end.getTime() - now.getTime();
  if (remaining <= 0) throw new Error('AUCTION_ENDED');
  return remaining <= 180_000 ? new Date(end.getTime() + 120_000) : end;
}
export function sevenDaysFrom(now: Date): Date {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}
