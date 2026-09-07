import assert from 'node:assert/strict'
import test from 'node:test'
import { livesLeft, lifeRemainingMs, totalTaskMs } from '../src/lib/task-focus.ts'
test('жизни и обратный отсчёт на границах бюджета', () => {
  assert.deepEqual([0,899999,900000,2700000,5400000].map(livesLeft),[3,3,2,1,0])
  assert.deepEqual([0,900000,2700000,5400000].map(lifeRemainingMs),[900000,1800000,2700000,0])
})
test('общее время включает любую глубину, старую историю и отменённых потомков ровно один раз', () => {
  const row = (id:string,parentTaskId:string|null,focusSpentMs:number,actualSeconds=0) => ({id,parentTaskId,focusSpentMs,actualSeconds,sessionSeconds:0})
  const rows = [row('root',null,5400000),row('child','root',1200000),row('nested','child',300000),row('cancelled','root',600000),row('unrelated',null,12345)]
  assert.equal(totalTaskMs(rows,'root'),7500000)
  assert.equal(totalTaskMs(rows,'child'),1500000)
  assert.equal(totalTaskMs([row('legacy',null,0,10000)],'legacy'),10000000)
  assert.equal(totalTaskMs([...rows, rows[1]!],'root'),7500000)
})
