import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
const sets=[
 ['golf',['2020 Volkswagen Golf Style 1.5 Front.jpg','2020 Volkswagen Golf Style 1.5 Rear.jpg','2020 Volkswagen Golf Style 1.5 Side.jpg']],
 ['bmw',[1,2,3,4].map(n=>`BMW G21 320d Touring Luxury Line Mineral Grey Metallic (${n}).jpg`)],
 ['mercedes',['52921068996','52920488037','52920488052'].map(n=>`Mercedes-Benz C 220 d (W205, 2016) (${n}).jpg`)],
 ['audi',['2021 Audi Q5 S Line 45 TFSi MHEV Quattro facelift 2.0 Front.jpg','2021 Audi Q5 S Line 45 TFSi MHEV Quattro facelift 2.0 Rear.jpg','2021 Audi Q5 S Line 45 TFSi MHEV Quattro.jpg']],
 ['skoda',['0574','0573','0190'].map(n=>`Skoda Octavia IV Combi RS Auto Zuerich 2021 IMG ${n}.jpg`)],
 ['toyota',['53129742057','53129742052','53130543899'].map(n=>`Toyota Yaris Hybrid (2023) (${n}).jpg`)],
 ['volvo',['49675205258','49675205168','49675743441','49675743366','49675205308'].map(n=>`Volvo XC60 Foto 2020 Free image (${n}).jpg`)],
 ['renault',['Front','Rear'].map(n=>`2020 Renault Clio Play TCe - 999cc 1.0 (100PS) Petrol - Iron Blue - 05-2024, ${n}.jpg`)],
 ['porsche',['2018 Porsche 718 Cayman.jpg','2018 Porsche 718 Cayman 2.jpg']],
 ['tesla',['2021 Tesla Model 3, front 11.10.21.jpg','2021 Tesla Model 3, front (2) 11.10.21.jpg','2021 Tesla Model 3, rear 11.10.21.jpg']],
 ['fiat',['Fiat 500 1.0 GSE Hybrid (Facelift) – f 22062025.jpg','Fiat 500 1.0 GSE Hybrid (Facelift) – h 22062025.jpg']],
 ['subaru',['2020 Subaru Outback front, 8,17.19.jpg','2020 Subaru Outback front angle, 8.17.19.jpg','2020 Subaru Outback rear angle, 8.17.19.jpg','2020 Subaru Outback rear, 8.17.19.jpg']],
 ['bmwx',[6,8,10].map(n=>`BMW G21 320d Touring Luxury Line Mineral Grey Metallic (${n}).jpg`)],
 ['audix',[1,3,5,7].map(n=>`Audi Q5 40 TDI quattro S-line Black Edition 80A Glacier White Metallic (${n}).jpg`)],
 ['toyotax',['Toyota YARIS HYBRID G 2WD (6AA-MXPH10-AHXGB) front.jpg','Toyota YARIS HYBRID G 2WD (6AA-MXPH10-AHXGB) rear.jpg','The interior of Toyota YARIS HYBRID G 2WD (6AA-MXPH10-AHXGB).jpg']],
 ['volvox',['2018 Volvo XC60 R-Design D5 P-Pulse 2.0 Front.jpg','2018 Volvo XC60 R-Design D5 P-Pulse 2.0 Rear.jpg']],
 ['porschex',['2018 Porsche 718 Cayman S S-A 2.5 Front.jpg','2018 Porsche 718 Cayman S S-A 2.5 Rear.jpg']],
 ['toyotay',['2020 Toyota Yaris Design HEV CVT 1.5 Front.jpg','2020 Toyota Yaris Design HEV CVT 1.5 Rear.jpg']],
];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchSafe(url){
 for(let attempt=0;attempt<4;attempt++){
  const r=await fetch(url,{headers:{'User-Agent':'AutoVeriLocalDemo/1.0 (licensed photo sourcing)'}});
  if(r.ok)return r;
  if(r.status!==429 && r.status!==503)throw Error(`${r.status}: ${url}`);
  await pause(Math.min(30000,Math.max(3000,Number(r.headers.get('retry-after')||10)*1000)));
 }
 throw Error('Source rate limit; retry later');
}
await mkdir('.local/commons/candidates',{recursive:true});
const candidates=[];
for(const [key,titles] of sets){
 let pages;
 try {pages=JSON.parse(await readFile(`.local/commons/${key}-metadata.json`,'utf8'));}
 catch {
  const p=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',iiprop:'url|extmetadata|size|sha1',iiurlwidth:'1280',titles:titles.map(t=>'File:'+t).join('|')});
  const data=await (await fetchSafe('https://commons.wikimedia.org/w/api.php?'+p)).json();pages=Object.values(data.query.pages);
  await writeFile(`.local/commons/${key}-metadata.json`,JSON.stringify(pages,null,2));await pause(1600);
 }
 for(const [i,title] of titles.entries()){
  const page=pages.find(p=>p.title==='File:'+title),info=page?.imageinfo?.[0];
  if(!info)throw Error('Missing '+title);
  const meta=info.extmetadata;
  if(!/CC BY|CC0|Public domain/i.test(meta.LicenseShortName?.value ?? ''))throw Error('Review license '+title);
  const path=`.local/commons/candidates/${key}-${i+1}.jpg`;
  try {await access(path);} catch {const r=await fetchSafe(info.thumburl ?? info.url);await writeFile(path,Buffer.from(await r.arrayBuffer()));await pause(1600);}
  candidates.push({key,index:i+1,title,path,info});
  console.log(`${key}-${i+1}: ${meta.LicenseShortName?.value} | ${meta.Artist?.value} | ${meta.DateTimeOriginal?.value}`);
 }
}
await writeFile('.local/commons/candidates.json',JSON.stringify(candidates,null,2));
