import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();let handler;const originalFetch=globalThis.fetch;
const base='http://localhost:4173';
before(async()=>{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;');
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 await db.exec('set role service_role');
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-secret-key',ALLOWED_ORIGINS:base}[key])},serve:fn=>handler=fn};
 globalThis.fetch=async(url,init)=>{
  assert.equal(init.headers.apikey,'test-secret-key');
  const name=String(url).split('/').at(-1);assert.ok(['escape_state','escape_create','escape_join','escape_submit'].includes(name));
  const args=JSON.parse(init.body),entries=Object.entries(args);
  try{const result=await db.query(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as result`,entries.map(([,v])=>v));return Response.json(result.rows[0].result);}
  catch(e){return Response.json({message:e.message},{status:400});}
 };
 await import('../supabase/functions/escape-game/index.ts');
});
after(async()=>{globalThis.fetch=originalFetch;delete globalThis.Deno;await db.close();});
async function call(body,origin=base,method='POST'){
 const req=new Request('https://test.supabase.co/functions/v1/escape-game',{method,headers:{origin,'content-type':'application/json','x-forwarded-for':'192.0.2.1'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 const res=await handler(req);return {status:res.status,data:res.status===204?null:await res.json()};
}
async function expireCooldown(){await db.exec("update public.escape_members set last_attempt_at=now()-interval '3 seconds'");}
let a,b,guest;
test('CORS and malformed or unauthenticated requests fail closed',async()=>{
 assert.equal((await call({action:'create',name:'A'},'https://other.example')).status,403);
 assert.equal((await call({},base,'OPTIONS')).status,204);
 assert.equal((await call({action:'state'})).status,401);
 assert.equal((await call({action:'create',name:'<script>'})).status,400);
 assert.equal((await call({action:'submit',stage:5,answer:'A',token:'a'.repeat(48)})).status,400);
});
test('two independent teams and a member join have isolated credentials',async()=>{
 a=(await call({action:'create',name:'윤'})).data;
 b=(await call({action:'create',name:'서'})).data;
 assert.match(a.token,/^[a-f0-9]{48}$/);assert.notEqual(a.token,b.token);assert.notEqual(a.team.code,b.team.code);
 guest=(await call({action:'join',name:'기록자',code:a.team.code})).data;assert.equal(guest.me.slot,1);
 const data=(await call({action:'state',token:a.token})).data;assert.equal(data.members.length,2);assert.equal(JSON.stringify(data).includes('token_hash'),false);
 assert.equal((await call({action:'state',token:'f'.repeat(48)})).status,401);
});
test('wrong guesses do not advance; simultaneous correct guesses only unlock once',async()=>{
 const wrong=await call({action:'submit',token:a.token,stage:0,answer:'0000'});assert.equal(wrong.data.correct,false);assert.equal(wrong.data.team.solved,0);
 assert.equal((await call({action:'submit',token:a.token,stage:0,answer:'3142'})).status,429);
 await expireCooldown();
 const results=await Promise.all([call({action:'submit',token:a.token,stage:0,answer:'3142'}),call({action:'submit',token:guest.token,stage:0,answer:'3142'})]);
 assert.equal(results.filter(r=>r.data.correct).length,1);assert.equal(results.filter(r=>r.data.stale).length,1);
 assert.equal((await call({action:'state',token:guest.token})).data.team.solved,1);
 assert.equal((await call({action:'state',token:b.token})).data.team.solved,0);
});
test('all team chapters complete, while future skips and late joins are denied',async()=>{
 assert.equal((await call({action:'submit',token:a.token,stage:4,answer:'6284'})).data.stale,true);
 for(const [stage,answer] of [[1,'A / 다리 쪽'],[2,'7209'],[3,'A'],[4,'6284']]){
  await expireCooldown();const result=await call({action:'submit',token:a.token,stage,answer});assert.equal(result.status,200);assert.equal(result.data.correct,true);assert.equal(result.data.team.solved,stage+1);
  if(stage===1)assert.equal((await call({action:'join',name:'늦은 참가',code:a.team.code})).status,400);
 }
 const replay=await call({action:'submit',token:a.token,stage:4,answer:'6284'});assert.equal(replay.data.stale,true);assert.equal(replay.data.team.solved,5);
});
test('four-player capacity is enforced atomically',async()=>{
 await call({action:'join',name:'둘',code:b.team.code});
 await call({action:'join',name:'셋',code:b.team.code});
 const results=await Promise.all([call({action:'join',name:'넷',code:b.team.code}),call({action:'join',name:'다섯',code:b.team.code})]);
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===400).length,1);
 assert.equal((await call({action:'state',token:b.token})).data.members.length,4);
});
test('direct client roles cannot read data, modify teams or invoke privileged functions',async()=>{
 await db.exec('reset role');
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  for(const query of ['select * from public.escape_members','select * from public.escape_teams',"update public.escape_teams set solved=5",`select public.escape_state('${'a'.repeat(64)}')`,`select public.escape_submit('${'a'.repeat(64)}',0,'3142')`])await assert.rejects(db.query(query),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
});
test('expired team sessions cannot read or solve',async()=>{
 await db.query('update public.escape_teams set expires_at=now()-interval \'1 day\' where code=$1',[b.team.code]);
 assert.equal((await call({action:'state',token:b.token})).status,410);
 assert.equal((await call({action:'submit',token:b.token,stage:0,answer:'3142'})).status,410);
});
