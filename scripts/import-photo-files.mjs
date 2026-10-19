import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const selected=[
 ['Volkswagen Golf',['golf-1','golf-2','golf-3'],'Same silver car, plate BF70 ENV, wheels and forecourt; one photographer on 2020-09-02.'],
 ['BMW 320d Touring',['bmw-3','bmwx-2','bmwx-3'],'Same grey G21, wheels, parking bay, surrounding cars and photographer within two minutes on 2025-06-25.'],
 ['Mercedes-Benz C 220 d',['mercedes-1','mercedes-3','mercedes-2'],'Same black W205 moving through the same street, same roof/wheels and photographer sequence on 2023-04-17.'],
 ['Audi Q5 40 TDI',['audix-2','audix-4','audix-1'],'Same white Q5, matching plate 228…2178, wheels and display bay, same photographer within two minutes.'],
 ['Škoda Octavia Combi',['skoda-2','skoda-3','skoda-1'],'Same lime Octavia RS display car at Auto Zurich 2021; matching display, wheels and paint. Interior taken immediately after front view by the same photographer.'],
 ['Toyota Yaris Hybrid',['toyotay-1','toyotay-2'],'Same red Yaris, wheels, wet forecourt and dealership, same photographer 69 seconds apart.'],
 ['Volvo XC60',['volvox-1','volvox-2'],'Same silver XC60 R-Design, wheels and forecourt; same photographer 24 seconds apart. Photographed variant is D5, not the fictional B4 specification.'],
 ['Renault Clio',['renault-1','renault-2'],'Same blue Clio, matching partially masked plate 70, wheels and parking lot; same photographer/date.'],
 ['Porsche 718 Cayman',['porschex-1','porschex-2'],'Same grey Cayman S, plate G6 CHY, wheels and fence; same photographer 29 seconds apart.'],
 ['Tesla Model 3',['tesla-1','tesla-2','tesla-3'],'Same white Model 3, temporary plate, black wheels and residential driveway; same photographer within 31 seconds.'],
 ['Fiat 500 Hybrid',['fiat-1','fiat-2'],'Same white Fiat, wheel design, chrome trim, parking bay and neighbouring red car; same photographer/date.'],
 ['Subaru Outback',['subaru-2','subaru-1','subaru-3','subaru-4'],'Same red demonstrator, roof rails, wheels, promotional side lettering and dealership; same photographer within seven minutes.'],
];
const candidates=JSON.parse(await readFile('.local/commons/candidates.json','utf8'));
const clean=s=>String(s??'').replace(/<[^>]*>/g,'').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#039;',"'").replaceAll('&nbsp;',' ').trim();
await mkdir('public/samples/photos',{recursive:true});await mkdir('src/data',{recursive:true});
const manifest=[];
for(const [n,[vehicle,keys,evidence]] of selected.entries()){
 const photos=[];
 for(const [i,key] of keys.entries()){
  const item=candidates.find(c=>`${c.key}-${c.index}`===key);if(!item)throw Error(key);
  const m=item.info.extmetadata,src=`/samples/photos/car-${n+1}-${i+1}.jpg`;
  const bytes=await readFile(item.path);
  if(bytes[0]!==255||bytes[1]!==216)throw Error('Not JPEG '+key);
  await copyFile(item.path,'public'+src);
  const rawLink=m.Artist?.value.match(/href="([^"]+)"/)?.[1];
  const authorUrl=rawLink?.startsWith('//')?'https:'+rawLink:rawLink?.startsWith('https://')?rawLink:undefined;
  const licenseUrl=m.LicenseUrl?.value;
  if(!licenseUrl?.startsWith('https://creativecommons.org/'))throw Error('License URL '+key);
  photos.push({src,title:item.title,author:clean(m.Artist?.value),...(authorUrl?{authorUrl}:{}),license:clean(m.LicenseShortName?.value),licenseUrl,
   sourceUrl:item.info.descriptionurl,originalUrl:item.info.url,downloadUrl:item.info.thumburl ?? item.info.url,
   attribution:clean(m.Attribution?.value)||clean(m.Artist?.value)+' / Wikimedia Commons',
   changes:'Wikimedia-generated 1280px preview; no additional image edits by AutoVeri. Existing masking is part of the source image.',
   taken:clean(m.DateTimeOriginal?.value),commonsSha1:item.info.sha1,sha256:createHash('sha256').update(bytes).digest('hex'),
  });
 }
 manifest.push({index:n+1,vehicle,sameVehicleEvidence:evidence,photos});
}
await writeFile('src/data/sample-photos.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile('public/samples/photo-licenses.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile('public/samples/PHOTO-CREDITS.md','# Sample vehicle photo credits\n\nThese are representative licensed photographs, not vehicles offered for sale. Sample dates, trim and technical specifications are fictional and may differ. Each gallery shows one physical vehicle. Photo licenses apply to the images, not the application code. No endorsement is implied.\n\n'+manifest.map(s=>`## ${s.index}. ${s.vehicle}\n\n${s.sameVehicleEvidence}\n\n`+s.photos.map(p=>`- [${p.title}](${p.sourceUrl}) — ${p.attribution}. [${p.license}](${p.licenseUrl}). Local file: ${p.src}. ${p.changes}`).join('\n')).join('\n\n')+'\n');
console.log(`Imported ${manifest.reduce((n,s)=>n+s.photos.length,0)} licensed photos across ${manifest.length} visually reviewed galleries.`);
