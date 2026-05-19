import assert from 'node:assert/strict'
import test from 'node:test'

import { filterIncompletePlanTree, formatPlanTree } from '../src/components/sections/plan-tree.ts'

test('formats prompt tree with only incomplete tasks while preserving non-empty parents', () => {
  const filtered = filterIncompletePlanTree([
    {
      title: 'Этап 1',
      completed: false,
      children: [
        {
          title: 'Готовая задача',
          completed: true,
          children: [],
        },
        {
          title: 'Активная задача',
          completed: false,
          note: 'Важная деталь',
          children: [],
        },
      ],
    },
    {
      title: 'Этап 2',
      completed: false,
      children: [
        {
          title: 'Только готовая задача',
          completed: true,
          children: [],
        },
      ],
    },
  ])

  assert.deepEqual(formatPlanTree(filtered), [
    '- Этап 1',
    '  - [ ] Активная задача',
    '    Примечание: Важная деталь',
  ])
})
