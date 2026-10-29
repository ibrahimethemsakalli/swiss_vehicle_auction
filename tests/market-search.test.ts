import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSearchSql } from '../src/lib/market-search';

test('SQL search parameters never become executable SQL or identifiers', () => {
  const payload = 'x\'; DROP TABLE "Vehicle"; --';
  const query = marketSearchSql({ make: payload, query: payload, city: payload }, 2);
  assert.ok(!query.ids.text.includes(payload));
  assert.ok(query.ids.values.includes(payload));
  assert.match(query.ids.text, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.deepEqual(query.ids.values.slice(-2), [24, 24]);
  assert.throws(() => marketSearchSql({ specs: { 'make;DROP TABLE': 'x' } }, 1));
  assert.throws(() => marketSearchSql({ ranges: { id: { min: 0 } } }, 1));
});
test('sorting remains deterministic with null end dates last and bounded pages', () => {
  assert.match(marketSearchSql({}, 1).ids.text, /auctionEndsAt" ASC NULLS LAST, v.id ASC/);
  for (const [sort, direction] of [
    ['priceAsc', 'ASC'],
    ['priceDesc', 'DESC'],
  ]) {
    const sql = marketSearchSql({ sort }, 1).ids.text;
    assert.ok(sql.includes('COALESCE(v."buyNowPrice", v."startPrice")'));
    assert.ok(sql.includes('COALESCE(v."currentPrice", v."startPrice")'));
    assert.ok(sql.includes(`END ${direction}, v.id ASC`));
  }
  for (const page of [0, -1, 1.5, 100001, Infinity]) assert.throws(() => marketSearchSql({}, page));
  assert.deepEqual(marketSearchSql({}, 100000).ids.values.slice(-2), [24, 2399976]);
});
