/**
 * Isolated component simulation, NOT an HTTP or Cloudflare capacity benchmark.
 * No URL/credentials accepted; network disabled. Node 22+ with strip-types.
 */
import {DatabaseSync} from "node:sqlite";
import {PublicCache} from "../src/lib/public-cache.server.ts";
import {performance} from "node:perf_hooks";
globalThis.fetch=()=>{throw Error("Network forbidden in isolated benchmark");};
const db=new DatabaseSync(":memory:");
db.exec("CREATE TABLE catalogue(id INTEGER PRIMARY KEY, rate INTEGER); CREATE TABLE members(id INTEGER PRIMARY KEY,balance INTEGER);");
db.exec("BEGIN");
for(let i=0;i<1000;i++)db.prepare("INSERT INTO catalogue VALUES(?,?)").run(i,100+i);
for(let i=0;i<10000;i++)db.prepare("INSERT INTO members VALUES(?,?)").run(i,100000);
db.exec("COMMIT");
const publicSql=db.prepare("SELECT * FROM catalogue ORDER BY id LIMIT 100");
const privateSql=db.prepare("SELECT balance FROM members WHERE id=?");
for(const cached of [false,true]){
  const cache=new PublicCache();const latencies=[];let reads=0,rows=0,errors=0;
  const cpu=process.cpuUsage(),start=performance.now();
  const load=async(pub,id)=>{
    reads++;
    await new Promise(r=>setTimeout(r,5)); // Explicit synthetic transport latency
    const result=pub?publicSql.all():privateSql.get(id%10000);rows+=pub?100:1;return result;
  };
  // 100 simultaneous operations in each of 20 bursts; 70% public, 30% private.
  for(let batch=0;batch<20;batch++)await Promise.all(Array.from({length:100},async(_,i)=>{
    const t=performance.now(),pub=i%10<7;
    try{await(cached&&pub?cache.read("catalogue",()=>load(true,0)):load(pub,batch*100+i));}
    catch{errors++;}latencies.push(performance.now()-t);
  }));
  const duration=performance.now()-start,usage=process.cpuUsage(cpu);
  latencies.sort((a,b)=>a-b);
  console.log(JSON.stringify({mode:cached?"after":"before",requests:2000,concurrency:100,
    workload:"70% catalogue / 30% private read; no financial writes",dataset:{catalogue:1000,members:10000},
    duration_ms:duration,rps:2000000/duration,p50:latencies[1000],p95:latencies[1900],p99:latencies[1980],
    errors,database_calls:reads,returned_rows:rows,cpu_ms:(usage.user+usage.system)/1000,rss_bytes:process.memoryUsage().rss}));
}
db.close();
