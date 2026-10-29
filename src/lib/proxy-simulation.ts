// PM-25C proposal only. Pure integer-cent simulation: no database, gateway or live bids.
import { auctionEndAfterBid } from './auction-rules';
export type SimBidder = 'A' | 'B' | 'C';
export type SimCommand = {
  requestId: string;
  bidder: SimBidder;
  maximum: number;
  now: number;
  holdExpiresAt: number;
};
export type SimState = {
  start: number;
  increment: number;
  endsAt: number;
  lastAt: number;
  leader: { bidder: SimBidder; maximum: number; holdExpiresAt: number } | null;
  price: number | null;
  history: {
    command: SimCommand;
    price: number;
    leader: SimBidder;
    extended: boolean;
    outcome: 'FIRST' | 'RAISE_LIMIT' | 'NEW_LEADER' | 'DEFENDED';
    release: SimBidder | null;
  }[];
};
const money = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 99999999999;
export function cents(value: string) {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw Error('INVALID_INPUT');
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!money(result)) throw Error('INVALID_INPUT');
  return result;
}
export function startSimulation(start: number, increment: number, endsAt = 600000): SimState {
  if (!money(start) || !money(increment) || !Number.isSafeInteger(endsAt) || endsAt <= 0)
    throw Error('INVALID_INPUT');
  return { start, increment, endsAt, lastAt: 0, leader: null, price: null, history: [] };
}
export function simulateBid(state: SimState, raw: SimCommand): SimState {
  const c = { ...raw };
  if (
    !['A', 'B', 'C'].includes(c.bidder) ||
    !money(c.maximum) ||
    !Number.isSafeInteger(c.now) ||
    c.now < 0 ||
    !Number.isSafeInteger(c.holdExpiresAt) ||
    !/^[a-zA-Z0-9-]{1,60}$/.test(c.requestId)
  )
    throw Error('INVALID_INPUT');
  const prior = state.history.find((h) => h.command.requestId === c.requestId);
  if (prior) {
    if (
      Object.keys(c).some((k) => c[k as keyof SimCommand] !== prior.command[k as keyof SimCommand])
    )
      throw Error('REQUEST_CONFLICT');
    return state; // Retrying an accepted command never reprices or extends again.
  }
  if (state.history.length >= 50) throw Error('SIM_LIMIT');
  if (c.now < state.lastAt) throw Error('INVALID_INPUT');
  if (c.now >= state.endsAt) throw Error('AUCTION_ENDED');
  if (c.holdExpiresAt <= c.now) throw Error('INVALID_HOLD');
  if (state.leader && state.leader.holdExpiresAt <= c.now) throw Error('LEADER_HOLD_EXPIRED');
  let price: number,
    outcome: SimState['history'][number]['outcome'],
    release: SimBidder | null = null;
  let leader = state.leader;
  if (leader?.bidder === c.bidder) {
    if (c.maximum <= leader.maximum) throw Error('LIMIT_NOT_HIGHER');
    price = state.price!;
    leader = { ...leader, maximum: c.maximum }; // A limit increase cannot silently renew a hold.
    outcome = 'RAISE_LIMIT';
  } else {
    const minimum = state.price === null ? state.start : state.price + state.increment;
    if (c.maximum < minimum) throw Error('BID_TOO_LOW');
    if (!leader) {
      price = state.start;
      leader = { bidder: c.bidder, maximum: c.maximum, holdExpiresAt: c.holdExpiresAt };
      outcome = 'FIRST';
    } else if (c.maximum > leader.maximum) {
      price = Math.min(c.maximum, leader.maximum + state.increment);
      release = leader.bidder;
      leader = { bidder: c.bidder, maximum: c.maximum, holdExpiresAt: c.holdExpiresAt };
      outcome = 'NEW_LEADER';
    } else {
      // Equal caps keep the incumbent: its maximum was accepted first.
      price = Math.min(leader.maximum, c.maximum + state.increment);
      release = c.bidder;
      outcome = 'DEFENDED';
    }
  }
  const end =
    outcome === 'RAISE_LIMIT'
      ? state.endsAt
      : +auctionEndAfterBid(new Date(state.endsAt), new Date(c.now));
  return {
    ...state,
    price,
    leader,
    endsAt: end,
    lastAt: c.now,
    history: [
      ...state.history,
      {
        command: c,
        price,
        leader: leader!.bidder,
        extended: end !== state.endsAt,
        outcome,
        release,
      },
    ],
  };
}
