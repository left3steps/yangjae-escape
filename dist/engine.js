export const SAVE_KEY='yangjae-escape:v1';
export const TOTAL=5;
export function freshState(){return {version:1,started:false,startedAt:null,solved:0,pendingReveal:null,reads:{},hints:{},attempts:0,finishedAt:null};}
export function restoreState(raw){
  try{const s=typeof raw==='string'?JSON.parse(raw):raw;
    if(!s||s.version!==1||!Number.isInteger(s.solved)||s.solved<0||s.solved>TOTAL) return freshState();
    const validCounts=(o)=>Object.fromEntries(Object.entries(o&&typeof o==='object'?o:{}).filter(([k,v])=>/^(intro|bridge|bank|stage|path|archive)$/.test(k)&&Number.isInteger(v)&&v>=0&&v<=20));
    return {...freshState(),started:!!s.started,startedAt:Number.isFinite(s.startedAt)?s.startedAt:null,solved:s.solved,pendingReveal:Number.isInteger(s.pendingReveal)&&s.pendingReveal===s.solved-1?s.pendingReveal:null,reads:validCounts(s.reads),hints:validCounts(s.hints),attempts:Number.isInteger(s.attempts)&&s.attempts>=0?s.attempts:0,finishedAt:Number.isFinite(s.finishedAt)?s.finishedAt:null};
  }catch{return freshState();}
}
export function normalizeAnswer(value){return String(value??'').normalize('NFKC').trim().replace(/[\s/·→,-]/g,'').toUpperCase();}
// Solo trial answers. Online games are validated independently in the database.
const KEYS=['3142','A다리쪽','7209','A','6284'];
export function correctAnswer(stage,answer){return Number.isInteger(stage)&&stage>=0&&stage<TOTAL&&normalizeAnswer(answer)===KEYS[stage];}
export function submitSolo(state,stage,answer,now=Date.now()){
  if(stage!==state.solved||state.pendingReveal!==null||state.solved>=TOTAL)return {ok:false,reason:'stage',state};
  if(!correctAnswer(stage,answer))return {ok:false,reason:'answer',state:{...state,attempts:state.attempts+1}};
  return {ok:true,state:{...state,solved:state.solved+1,pendingReveal:stage,attempts:state.attempts+1,finishedAt:stage===TOTAL-1?now:null}};
}
export function currentStage(state){return state.pendingReveal??Math.min(state.solved,TOTAL-1);}
export function advance(state){return {...state,pendingReveal:null};}
export function revealHint(state,id){return {...state,hints:{...state.hints,[id]:Math.min(3,(state.hints[id]||0)+1)}};}
export function hintTotal(state){return Object.values(state.hints).reduce((a,b)=>a+b,0);}
export function escapeHtml(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
