import fs from 'fs';const [a,b]=process.argv.slice(2).map(f=>JSON.parse(fs.readFileSync(f)));
const agg=rs=>{const m={};for(const r of rs){(m[r.config]??=[]).push(r)}return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,{p50:v.map(r=>r.dtP50P95[0]).sort((x,y)=>x-y)[v.length>>1],dropPct:Math.round(100*v.reduce((s,r)=>s+r.dropped,0)/v.reduce((s,r)=>s+r.movingFrames,0)),posW:Math.max(...v.map(r=>r.positionWritesShelf)),posF:Math.max(...v.map(r=>r.scriptPositionedFrames)),target:v[0].target,blocking:v[0].blockingOnPath.length,pass:v.every(r=>r.pass)}]))};
const A=agg(a),B=agg(b);console.log('config                  | '+process.argv[2]+'  vs  '+process.argv[3]);
for(const k of Object.keys(A))console.log(k.padEnd(24),JSON.stringify(A[k]),'\n'.padEnd(26),JSON.stringify(B[k]));
