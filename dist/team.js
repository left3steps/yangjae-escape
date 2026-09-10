import {CONFIG} from './config.js';
const KEY='yangjae-escape:team:v1';
export const teamConfigured=()=>/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(CONFIG.supabaseUrl)&&!!CONFIG.publishableKey;
export function loadTeam(){try{const s=JSON.parse(localStorage.getItem(KEY));return s&&/^[a-f0-9]{48}$/.test(s.token)&&/^[A-Z2-9]{8}$/.test(s.code)?s:null;}catch{return null;}}
export function saveTeam(team){localStorage.setItem(KEY,JSON.stringify(team));}
export function clearTeam(){localStorage.removeItem(KEY);}
export async function teamRequest(action,payload={},session=loadTeam()){
  if(!teamConfigured())throw Error('팀 플레이는 새 계정 연결 후 열립니다. 지금은 혼자 체험할 수 있어요.');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/${CONFIG.functionName}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':CONFIG.publishableKey},body:JSON.stringify({action,...payload,token:session?.token}),signal:controller.signal,cache:'no-store'});
    const data=await res.json();if(!res.ok)throw Error(data.error||'연결하지 못했습니다. 잠시 후 다시 시도해주세요.');return data;
  }catch(e){if(e.name==='AbortError')throw Error('연결이 늦어지고 있어요. 입력한 답은 그대로 남아 있습니다. 다시 시도해주세요.');if(e instanceof TypeError)throw Error('인터넷 연결을 확인해주세요. 팀 진행은 서버에 보관되어 있습니다.');throw e;}finally{clearTimeout(timeout);}
}
