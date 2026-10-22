import assert from 'node:assert/strict';
import test from 'node:test';
import { project, dependencyProjection, hasUnclassifiedWrite } from './fingerprint.mjs';
const vue='<script setup lang="ts">const amount=8000; const pay=()=>fetch("/pay",{method:"POST",body:JSON.stringify({amount})});</script><template><button class="red" @click="pay">Оплатить</button></template><style>.red{color:red}</style>';
const react='export const pay=()=>fetch("/pay",{method:"POST",body:JSON.stringify({amount:8000})}); export const Button=()=> <button className="red" onClick={pay}>Оплатить</button>;';
test('payment CSS and text preserve Vue critical projection',()=>assert.equal(project('Pay.vue',vue,'vue-critical'),project('Pay.vue',vue.replace('class="red"','class="blue"').replace('Оплатить','Купить').replace('color:red','color:blue'),'vue-critical')));
test('Vue payment amount and request payload invalidate the projection',()=>{
 assert.notEqual(project('Pay.vue',vue,'vue-critical'),project('Pay.vue',vue.replace('8000','16000'),'vue-critical'));
 assert.notEqual(project('Pay.vue',vue,'vue-critical'),project('Pay.vue',vue.replace('{amount}','{amount,currency:"USD"}'),'vue-critical'));
});
test('TSX payment styling/text preserve handlers and amount',()=>{
 assert.equal(project('Pay.tsx',react,'tsx-critical'),project('Pay.tsx',react.replace('className="red"','className="blue"').replace('Оплатить','Купить'),'tsx-critical'));
 assert.notEqual(project('Pay.tsx',react,'tsx-critical'),project('Pay.tsx',react.replace('8000','16000'),'tsx-critical'));
});
test('comments preserve script inputs, destructive writes do not',()=>{
 const code='export const save = () => fetch("/records/1", {method:"DELETE"});';
 assert.equal(project('save.ts',code,'typescript'),project('save.ts','// comment\n'+code,'typescript'));
 assert.notEqual(project('save.ts',code,'typescript'),project('save.ts',code.replace('/records/1','/records'),'typescript'));
 assert.equal(hasUnclassifiedWrite(code,'save.ts'),true);
});
test('locked dependency closure excludes unrelated packages',()=>{
 const lock={lockfileVersion:3,packages:{'node_modules/bank':{version:'1',dependencies:{decimal:'1'}},'node_modules/decimal':{version:'1'},'node_modules/icons':{version:'1'}}};
 const old=dependencyProjection(lock,['bank']);lock.packages['node_modules/icons'].version='2';assert.deepEqual(old,dependencyProjection(lock,['bank']));
 lock.packages['node_modules/decimal'].version='2';assert.notDeepEqual(old,dependencyProjection(lock,['bank']));
 assert.throws(()=>dependencyProjection(lock,['missing']));
});
