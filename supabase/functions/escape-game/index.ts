// No paid APIs and no third-party runtime packages.
// Custom authentication: every member has an unguessable 192-bit bearer token.
// Only its SHA-256 hash is stored. Every state/submit request checks membership.
// verify_jwt=false is intentional: there is no Supabase Auth account in this trial.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// Exact origins only. Configure both the production URL and a local preview URL.
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s=>s.trim()).filter(Boolean);
const ERRORS:Record<string,string> = {
 invalid_session:'참가 정보가 유효하지 않습니다. 초대 코드로 다시 참가해주세요.',
 expired_team:'이 팀의 체험 기간이 끝났습니다. 새 팀을 만들어주세요.',
 invalid_code:'초대 코드를 확인해주세요. 존재하지 않거나 만료된 팀입니다.',
 team_started:'이 팀은 이미 두 번째 기록을 복원했습니다. 단서 배분이 시작되어 새로 참가할 수 없습니다.',
 team_full:'이 팀에는 이미 4명이 참가했습니다.',
 rate_limit:'요청이 많습니다. 잠시 쉬었다가 다시 시도해주세요.',
 capacity_limit:'무료 체험의 동시 운영 한도에 도달했습니다. 지금은 혼자 체험할 수 있어요.',
 slow_down:'잠시만요. 2초 후에 다시 확인해주세요.',
};
function randomHex(bytes:number){return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
async function hash(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');}
function roomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>chars[v%chars.length]).join('');}
async function rpc(name:string,args:Record<string,unknown>){
 const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(9000)});
 const data=await response.json();
 if(!response.ok)throw new Error(data.message||'database_error');
 if(data?.error)throw new Error(data.error);
 return data;
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Vary:'Origin','Access-Control-Allow-Headers':'content-type, apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(!ORIGINS.includes(origin))return respond({error:'이 주소에서는 팀 플레이에 연결할 수 없습니다.'},403);
 headers['Access-Control-Allow-Origin']=origin;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'POST 요청만 지원합니다.'},405);
 if(!SUPABASE_URL||!SERVICE_KEY)return respond({error:'팀 플레이 연결을 준비하고 있습니다.'},503);
 if(Number(req.headers.get('content-length')||0)>2048)return respond({error:'요청이 너무 큽니다.'},413);
 try{
  const raw=await req.text();if(raw.length>2048)return respond({error:'요청이 너무 큽니다.'},413);
  let input;try{input=JSON.parse(raw);}catch{return respond({error:'요청 형식을 확인해주세요.'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input))return respond({error:'요청 형식을 확인해주세요.'},400);
  const {action}=input;
  if(action==='create'||action==='join'){
   if(typeof input.name!=='string'||input.name.trim().length<1||[...input.name.trim()].length>12||/[\u0000-\u001f<>]/.test(input.name))return respond({error:'별명은 1~12자로 입력해주세요.'},400);
   const token=randomHex(24),tokenHash=await hash(token);
   // Short-lived hashed network bucket is for quota protection, not identity.
   const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
   const bucket=await hash(`${SERVICE_KEY}:${new Date().toISOString().slice(0,10)}:${ip}`);
   const args={p_member_id:crypto.randomUUID(),p_token_hash:tokenHash,p_name:input.name.trim(),p_bucket:bucket};
   if(action==='join'){
    if(typeof input.code!=='string'||!/^[A-Z2-9]{8}$/.test(input.code))return respond({error:'8자리 초대 코드를 확인해주세요.'},400);
    const data=await rpc('escape_join',{...args,p_code:input.code});return respond({...data,token});
   }
   const data=await rpc('escape_create',{...args,p_team_id:crypto.randomUUID(),p_code:roomCode()});return respond({...data,token});
  }
  if(action!=='state'&&action!=='submit')return respond({error:'지원하지 않는 요청입니다.'},400);
  if(typeof input.token!=='string'||!/^[a-f0-9]{48}$/.test(input.token))return respond({error:ERRORS.invalid_session},401);
  const tokenHash=await hash(input.token);
  if(action==='state')return respond(await rpc('escape_state',{p_token_hash:tokenHash}));
  if(!Number.isInteger(input.stage)||input.stage<0||input.stage>4||typeof input.answer!=='string'||input.answer.length>32)return respond({error:'현재 기록과 입력한 답을 확인해주세요.'},400);
  return respond(await rpc('escape_submit',{p_token_hash:tokenHash,p_stage:input.stage,p_answer:input.answer.normalize('NFKC')}));
 }catch(e){
  const key=e instanceof Error?e.message:'';
  const status=key==='invalid_session'?401:key==='expired_team'?410:['slow_down','rate_limit','capacity_limit'].includes(key)?429:ERRORS[key]?400:503;
  return respond({error:ERRORS[key]||'팀 연결이 잠시 지연되고 있습니다. 다시 시도해주세요.'},status);
 }
});
