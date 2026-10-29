import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm17_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = `/${name}`;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()));
const admin = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migration.status, 0, migration.stderr);

  const { mutateTrust, readTrust, publicReputation } = await import('../src/lib/trust.ts');
  const { trustHandlers } = await import('../src/lib/trust-http.ts');
  const makeUser = (tag, role='PRIVATE_USER') => db.user.create({data:{email:`${tag}@example.invalid`,phone:tag,passwordHash:'test',role,emailVerifiedAt:new Date(),phoneVerifiedAt:new Date()}});
  const seller=await makeUser('seller'),buyer=await makeUser('buyer'),outsider=await makeUser('outsider'),moderator=await makeUser('moderator','ADMIN');
  const vehicleBase={userId:seller.id,stammnummer:'123456789',firstRegistration:new Date('2020-01-01'),make:'PM17',model:'Fixture',mileage:0,canton:'BE',mfkStatus:'UNKNOWN',mfkDate:null,serviceHistory:'NONE',tireCondition:'test',description:'synthetic local test',images:[],listingType:'AUCTION_7_DAYS',startPrice:1000,status:'ACTIVE'};
  const listing=await db.vehicle.create({data:{...vehicleBase,vinChassis:'PM17LISTING000001'}});
  const report=await mutateTrust(db,buyer.id,{action:'report',vehicleId:listing.id,category:'MISLEADING',note:'Private report note'});
  await assert.rejects(()=>mutateTrust(db,buyer.id,{action:'report',vehicleId:listing.id,category:'OTHER',note:'Duplicate case'}),/TRUST_DUPLICATE/);
  await assert.rejects(()=>mutateTrust(db,seller.id,{action:'report',vehicleId:listing.id,category:'OTHER',note:'Own listing report'}),/TRUST_INELIGIBLE/);
  await assert.rejects(()=>readTrust(db,buyer.id,{view:'adminReports'}),/FORBIDDEN/);
  await assert.rejects(()=>mutateTrust(db,buyer.id,{action:'decideReport',id:report.id,decision:'WARNING',note:'Unauthorized decision'}),/FORBIDDEN/);
  await mutateTrust(db,moderator.id,{action:'decideReport',id:report.id,decision:'WARNING',note:'Correct the description'});
  const reportRow=await db.listingReport.findUniqueOrThrow({where:{id:report.id}});
  assert.equal(reportRow.reviewedBy,moderator.id);assert.ok(reportRow.reviewedAt);assert.equal(reportRow.status,'CLOSED');
  await assert.rejects(()=>mutateTrust(db,moderator.id,{action:'decideReport',id:report.id,decision:'DISMISSED',note:'Cannot overwrite decision'}),/TRUST_CONFLICT/);
  const warnings=await readTrust(db,seller.id,{view:'warnings'});
  assert.equal(warnings.items.length,1);assert.equal('note' in warnings.items[0],false);assert.equal('reporterId' in warnings.items[0],false);
  assert.equal((await db.vehicle.findUnique({where:{id:listing.id}})).status,'ACTIVE');
  const ownAdminReport=await mutateTrust(db,moderator.id,{action:'report',vehicleId:listing.id,category:'OTHER',note:'Admin has a conflict'});
  await assert.rejects(()=>mutateTrust(db,moderator.id,{action:'decideReport',id:ownAdminReport.id,decision:'DISMISSED',note:'Self review forbidden'}),/TRUST_SELF_REVIEW/);
  async function sale(status,tag){
    const v=await db.vehicle.create({data:{...vehicleBase,vinChassis:tag,status:'SOLD'}});
    const h=await db.paymentHold.create({data:{userId:buyer.id,vehicleId:v.id,gateway:'LOCAL_TEST',amount:30,currency:'CHF',status:'CAPTURED_FEE',expiresAt:new Date()}});
    const b=await db.bid.create({data:{vehicleId:v.id,userId:buyer.id,holdId:h.id,requestId:randomUUID(),amount:1000,status:'WON'}});
    const s=await db.settlement.create({data:{vehicleId:v.id,bidId:b.id,status}});return {v,h,b,s};
  }
  const complete=await sale('COMPLETED','PM17COMPLETE00001'),pending=await sale('AWAITING_CONFIRMATION','PM17PENDING000001');
  const command={action:'rate',settlementId:complete.s.id,rating:4,note:'Completed sale review'};
  await assert.rejects(()=>mutateTrust(db,outsider.id,command),/TRUST_INELIGIBLE/);
  await assert.rejects(()=>mutateTrust(db,buyer.id,{...command,settlementId:pending.s.id}),/TRUST_INELIGIBLE/);
  const concurrent=await Promise.allSettled([mutateTrust(db,buyer.id,command),mutateTrust(db,buyer.id,command)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  const review=await db.saleReview.findFirstOrThrow({where:{settlementId:complete.s.id,authorId:buyer.id}});
  assert.equal(review.recipientId,seller.id);
  await mutateTrust(db,seller.id,{...command,rating:5,note:'Buyer feedback from seller'});
  const reverse=await db.saleReview.findFirstOrThrow({where:{settlementId:complete.s.id,authorId:seller.id}});
  await assert.rejects(()=>mutateTrust(db,outsider.id,{action:'reply',reviewId:review.id,note:'Not my review'}),/FORBIDDEN/);
  await mutateTrust(db,seller.id,{action:'reply',reviewId:review.id,note:'Thank you for the feedback'});
  await assert.rejects(()=>mutateTrust(db,seller.id,{action:'reply',reviewId:review.id,note:'Second reply rejected'}),/TRUST_CONFLICT/);
  let publicData=await publicReputation(db,listing.id,1);
  assert.equal(publicData.total,1);assert.equal(publicData.average,4);assert.equal(publicData.items[0].response,'Thank you for the feedback');
  for(const key of ['authorId','recipientId','settlementId','email','phone']) assert.equal(key in publicData.items[0],false);
  await mutateTrust(db,buyer.id,{action:'appeal',reviewId:review.id,note:'Please review the reply'});
  const appeal=await db.reviewAppeal.findUniqueOrThrow({where:{reviewId:review.id}});
  await mutateTrust(db,moderator.id,{action:'decideAppeal',id:appeal.id,decision:'HIDE',note:'Hidden following content review'});
  publicData=await publicReputation(db,listing.id,1);assert.equal(publicData.total,0);assert.equal(publicData.average,null);
  assert.equal((await readTrust(db,buyer.id,{view:'reviews'})).items.find(r=>r.id===review.id).status,'HIDDEN');
  await mutateTrust(db,buyer.id,{action:'appeal',reviewId:reverse.id,note:'Please review this feedback'});
  const keep=await db.reviewAppeal.findUniqueOrThrow({where:{reviewId:reverse.id}});
  await mutateTrust(db,moderator.id,{action:'decideAppeal',id:keep.id,decision:'KEEP',note:'Review complies with content rules'});
  assert.equal((await db.saleReview.findUnique({where:{id:reverse.id}})).status,'PUBLISHED');
  const http=trustHandlers(db,async()=>buyer.id),origin=process.env.NEXTAUTH_URL;
  const get=await http.GET(new Request(origin+'/api/trust?view=reviews'));
  assert.equal(get.status,200);assert.equal(get.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await trustHandlers(db,async()=>{throw Error('UNAUTHORIZED')}).GET(new Request(origin+'/api/trust'))).status,401);
  const post=(body,from=origin)=>http.POST(new Request(origin+'/api/trust',{method:'POST',headers:{origin:from},body:JSON.stringify(body)}));
  assert.equal((await post(command,'https://other.invalid')).status,403);
  assert.equal((await post({...command,authorId:outsider.id})).status,400);
  assert.equal((await post({note:'x'.repeat(12001)})).status,400);
  await db.user.update({where:{id:buyer.id},data:{suspendedAt:new Date()}});
  assert.equal((await http.GET(new Request(origin+'/api/trust'))).status,403);
  assert.equal((await db.paymentHold.findUnique({where:{id:complete.h.id}})).status,'CAPTURED_FEE');
  assert.equal(await db.transaction.count(),0);
  assert.ok(await db.notification.count()>0);
  console.log('PASS: reports, immutable moderator decisions, conflict-of-interest guard, completed-sale eligibility, concurrent duplicates, replies/appeals, public privacy and hidden-rating exclusion; no provider calls');
} finally {
  await db.$disconnect();
  const { db: globalDb } = await import('../src/lib/db.ts');
  await globalDb.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm17_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM17 database removed');
