import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { BUDGET_MS, LEASE_MS, confirmedInterval, createTaskFocus, livesLeft } from '../src/task-focus.js'

test('жизни сгорают строго на 15, 45 и 90 минутах', () => {
  assert.deepEqual([0,899999,900000,2699999,2700000,5399999,5400000].map(livesLeft), [3,3,2,2,1,1,0])
})
test('сон, отсутствие heartbeat и разрыв часов не создают рабочее время', () => {
  assert.equal(confirmedInterval(5000,5000),5000)
  assert.equal(confirmedInterval(5200,5000),5000)
  assert.equal(confirmedInterval(LEASE_MS+1,5000),0)
  assert.equal(confirmedInterval(5000,LEASE_MS+1),0)
  assert.equal(confirmedInterval(9000,5000),0)
  assert.equal(confirmedInterval(-1,5000),0)
})
const url = process.env.FOCUS_TEST_DATABASE_URL
// This test intentionally mutates time only in an explicitly selected disposable local database.
const safeDatabase = url && ['localhost','127.0.0.1'].includes(new URL(url).hostname) && new URL(url).pathname.startsWith('/tommma_focus_test_')
test('PostgreSQL: leases, retries, concurrency, budget, hierarchy and isolation', { skip: !safeDatabase }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const focus = createTaskFocus(prisma)
  const user = await prisma.user.create({ data: { nickname: `focus${Date.now()}`, email: `${randomUUID()}@example.invalid`, passwordHash:'test-only' } })
  const makeTask = (extra = {}) => prisma.task.create({ data: { id: randomUUID(), userId:user.id, title:'Test', doneWhen:'Result verified', columnId:'todo', dateKey:'2026-09-07', recurrence:'none', createdAtMs:BigInt(Date.now()), ...extra } })
  try {
    const legacy = await makeTask({ actualSeconds: 12345, sessionSeconds: 678, sessionStartedAtMs: 1n })
    assert.equal(legacy.focusSpentMs,0)
    assert.equal(livesLeft(legacy.focusSpentMs),3)
    const missing = await makeTask({ doneWhen:'' })
    await assert.rejects(focus.start(user.id,missing.id,randomUUID()), /Готово/)
    await assert.rejects(focus.start(user.id + 100000n,legacy.id,randomUUID()), /не найдена/)
    const id = randomUUID()
    await focus.start(user.id,legacy.id,id)
    const retry = await focus.start(user.id,legacy.id,id)
    assert.equal(retry.sessionId,id)
    await prisma.taskWorkSession.update({ where:{id},data:{checkpointAt:new Date(Date.now()-5000)} })
    const input = () => focus.checkpoint(user.id,id,1,5000,false)
    await Promise.all([input(),input(),input()])
    assert.equal((await prisma.task.findUniqueOrThrow({where:{id:legacy.id}})).focusSpentMs,5000)
    assert.equal((await prisma.taskWorkSession.findUniqueOrThrow({where:{id}})).creditedMs,5000)
    const second = await makeTask()
    const otherId = randomUUID()
    await Promise.all([focus.start(user.id,legacy.id,randomUUID()),focus.start(user.id,second.id,otherId)])
    assert.equal(await prisma.taskWorkSession.count({where:{userId:user.id,endedAt:null}}),1)
    assert.equal((await focus.checkpoint(user.id,id,2,5000,false)).running,false)
    await focus.pause(user.id,second.id)
    await focus.pause(user.id,legacy.id)
    const stale = randomUUID()
    await focus.start(user.id,legacy.id,stale)
    await prisma.taskWorkSession.update({where:{id:stale},data:{checkpointAt:new Date(Date.now()-120000)}})
    assert.equal((await focus.checkpoint(user.id,stale,1,120000,false)).running,false)
    assert.equal((await prisma.task.findUniqueOrThrow({where:{id:legacy.id}})).focusSpentMs,5000)
    const last = randomUUID()
    await focus.start(user.id,legacy.id,last)
    await prisma.task.update({where:{id:legacy.id},data:{focusSpentMs:BUDGET_MS-1000}})
    await prisma.taskWorkSession.update({where:{id:last},data:{checkpointAt:new Date(Date.now()-5000)}})
    assert.equal((await focus.checkpoint(user.id,last,1,5000,false)).running,false)
    const exhausted = await prisma.task.findUniqueOrThrow({where:{id:legacy.id}})
    assert.equal(exhausted.focusSpentMs,BUDGET_MS)
    assert.equal(exhausted.actualSeconds,12345)
    assert.equal(exhausted.sessionSeconds,678)
    await assert.rejects(focus.start(user.id,legacy.id,randomUUID()), /исчерпан/)
    const children = [1,2].map(i => ({id:randomUUID(), title:`Child ${i}`, doneWhen:`Result ${i}`}))
    await assert.rejects(focus.split(user.id,legacy.id,{doneWhen:'Result',workSummary:'',children:children.slice(0,1)}), /минимум две/)
    await focus.split(user.id,legacy.id,{doneWhen:'Result',workSummary:'Progress preserved',children})
    await focus.split(user.id,legacy.id,{doneWhen:'Result',workSummary:'Progress preserved',children})
    assert.equal(await prisma.task.count({where:{parentTaskId:legacy.id}}),2)
    const child = await prisma.task.findUniqueOrThrow({where:{id:children[0]!.id}})
    assert.equal(child.focusSpentMs,0)
    await assert.rejects(focus.start(user.id,legacy.id,randomUUID()), /исполняемой/)
    await focus.split(user.id,child.id,{doneWhen:'Result',workSummary:'',children:[{id:randomUUID(),title:'Nested',doneWhen:'Nested result'}]})
    assert.equal((await prisma.task.findUniqueOrThrow({where:{id:legacy.id}})).focusSpentMs,BUDGET_MS)
  } finally {
    // Keep synthetic rows for inspection in the disposable database; never delete user data.
    await prisma.$disconnect()
  }
})
