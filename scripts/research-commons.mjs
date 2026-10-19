import {mkdir,writeFile,access} from 'node:fs/promises';
const queries = [
 ['golf','intitle:"Volkswagen Golf" intitle:"Style 1.5"'],
 ['bmw','intitle:"BMW" intitle:"Touring" intitle:"G21"'],
 ['mercedes','intitle:"Mercedes-Benz" intitle:"C 220"'],
 ['audi','intitle:"Audi Q5"'],
 ['skoda','intitle:"Octavia" intitle:"2021"'],
 ['toyota','intitle:"Yaris" intitle:"2023"'],
 ['volvo','intitle:"Volvo XC60" intitle:"2020"'],
 ['renault','intitle:"Renault Clio" intitle:"2020"'],
 ['porsche','intitle:"718 Cayman"'],
 ['tesla','intitle:"Tesla Model 3" intitle:"2021"'],
 ['fiat','intitle:"Fiat 500" intitle:"Hybrid"'],
 ['subaru','intitle:"Subaru Outback" intitle:"2020"'],
 ['audi-tdi','intitle:"Audi Q5" intitle:"TDI" intitle:"2021"'],
 ['cayman-base','intitle:"718 Cayman" -intitle:GT4 -intitle:GTS'],
 ['skoda-combi','intitle:"Octavia" intitle:"Combi" intitle:"2020"'],
 ['mercedes-d','intitle:"C 220 d" -intitle:Stationwagon -intitle:All-Terrain'],
 ['audi-2021','intitle:"2021 Audi Q5"'],
 ['volvo-b4','intitle:"Volvo XC60" intitle:"B4"'],
 ['porsche-2018','intitle:"2018 Porsche 718 Cayman"'],
 ['audi-40','intitle:"Q5" intitle:"40 TDI"'],
 ['toyota-front','intitle:"Yaris" intitle:"Hybrid" intitle:"Front"'],
 ['volvo-pair','intitle:"XC60" intitle:"Front"'],
 ['toyota-g','intitle:"Toyota YARIS HYBRID G 2WD"'],
 ['volvo-2018','intitle:"2018 Volvo XC60 R-Design D5"'],
 ['toyota-hev','intitle:"Yaris" intitle:"HEV" -intitle:Cross'],
];
await mkdir('.local/commons',{recursive:true});
for(const [key,q] of queries){
 try {await access(`.local/commons/${key}.json`);continue;} catch {}
 await new Promise(r=>setTimeout(r,1800));
 const p=new URLSearchParams({action:'query',format:'json',list:'search',srnamespace:'6',srsearch:q,srlimit:'60'});
 const r=await fetch('https://commons.wikimedia.org/w/api.php?'+p,{headers:{'User-Agent':'AutoVeriLocalDemo/1.0 (licensed image attribution research)'}});
 if(!r.ok)throw Error(String(r.status)+' retry-after '+r.headers.get('retry-after'));const d=await r.json();
 await writeFile(`.local/commons/${key}.json`,JSON.stringify(d,null,2));
 console.log(key+':\n'+d.query.search.map(v=>v.title).join('\n'));
}
