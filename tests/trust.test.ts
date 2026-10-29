import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trustCommand, trustQuery, reportCategories } from '../src/lib/trust-rules';
const id='00000000-0000-4000-8000-000000000017';
test('feedback commands reject injected ownership, invalid stars and unbounded text',()=>{
 const valid={action:'rate',settlementId:id,rating:5,note:'Completed sale feedback'};
 assert.ok(trustCommand.safeParse(valid).success);
 for(const bad of [{...valid,rating:0},{...valid,rating:6},{...valid,rating:1.5},{...valid,authorId:id},{...valid,recipientId:id},{...valid,note:'    '},{...valid,note:'x'.repeat(1001)}]) assert.equal(trustCommand.safeParse(bad).success,false);
 for(const category of reportCategories) assert.ok(trustCommand.safeParse({action:'report',vehicleId:id,category,note:'Test report reason'}).success);
 assert.equal(trustCommand.safeParse({action:'decideAppeal',id,decision:'CAPTURE',note:'Do not allow this'}).success,false);
});
test('trust list queries use bounded pages and explicit views',()=>{
 assert.equal(trustQuery.parse({}).page,1);
 for(const q of [{page:0},{page:'1.5'},{page:100001},{view:'allUsers'},{userId:id}]) assert.equal(trustQuery.safeParse(q).success,false);
});
test('new trust copy exists in all four languages',()=>{
 const catalogs=['de','fr','it','en'].map(l=>JSON.parse(readFileSync(`src/messages/${l}.json`,'utf8')));
 for(const key of Object.keys(catalogs[0]).filter(k=>k.startsWith('trust'))) for(const c of catalogs){assert.ok(c[key],key);assert.deepEqual(c[key].match(/\{\{\w+\}\}/g),catalogs[0][key].match(/\{\{\w+\}\}/g));}
});
