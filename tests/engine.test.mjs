import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,restoreState,submitSolo,advance,revealHint,normalizeAnswer,currentStage} from '../dist/engine.js';
import {STAGES} from '../dist/story.js';

test('five chapters can be completed, saved and resumed without losing the reveal',()=>{
 let state={...freshState(),started:true,startedAt:1};
 const answers=['3142','A / 다리 쪽','7209','A','6284'];
 for(let i=0;i<5;i++){
  const wrong=submitSolo(state,i,'wrong');assert.equal(wrong.ok,false);assert.equal(wrong.state.solved,i);
  const right=submitSolo(wrong.state,i,answers[i],100+i);assert.equal(right.ok,true);state=restoreState(JSON.stringify(right.state));
  assert.equal(state.solved,i+1);assert.equal(currentStage(state),i);assert.equal(state.pendingReveal,i);
  assert.equal(submitSolo(state,i,answers[i]).ok,false,'repeat clicks cannot solve twice');state=advance(state);
 }
 assert.equal(state.solved,5);assert.equal(state.finishedAt,104);assert.equal(state.attempts,10);
});
test('future stages and guesses while a reveal is open cannot skip content',()=>{
 const state=freshState();assert.equal(submitSolo(state,4,'6284').ok,false);assert.equal(state.solved,0);
 const solved=submitSolo(state,0,'3142').state;assert.equal(submitSolo(solved,1,'A다리쪽').ok,false);
});
test('mobile full-width numbers and whitespace normalize consistently',()=>{
 assert.equal(normalizeAnswer(' ３１４２ '),'3142');assert.equal(submitSolo(freshState(),0,'３１４２').ok,true);
});
test('corrupt or unsupported saved data is safely ignored',()=>{
 for(const raw of ['{bad',null,'{}','{"version":1,"solved":99}','{"version":2,"solved":2}'])assert.deepEqual(restoreState(raw),freshState());
 const state=restoreState({version:1,solved:2,pendingReveal:4,reads:{bridge:3,alien:9,bank:-1},hints:{bridge:2,stage:'three'},attempts:-9});
 assert.equal(state.pendingReveal,null);assert.deepEqual(state.reads,{bridge:3});assert.deepEqual(state.hints,{bridge:2});assert.equal(state.attempts,0);
});
test('hints cap at three and all puzzles have evidence for their answers',()=>{
 let state=freshState();for(let i=0;i<8;i++)state=revealHint(state,'bridge');assert.equal(state.hints.bridge,3);
 assert.equal(STAGES.length,5);assert.equal(STAGES.slice(0,4).map(s=>s.code).join(''),'6284');
 STAGES.forEach(s=>assert.equal(s.hints.length,3));
});
