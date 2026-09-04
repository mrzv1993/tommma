import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePriorityTaskTitle,
  priorityProjectBadgeStyle,
  priorityProjectHue,
} from '../src/components/sections/priority-task-title.ts'

test('extracts only a leading project hashtag and keeps source offsets for inline editing', () => {
  assert.deepEqual(parsePriorityTaskTitle('#фелиз Замена фотографий'), {
    project: 'фелиз',
    projectOffset: 1,
    title: 'Замена фотографий',
    titleOffset: 7,
  })
  assert.deepEqual(parsePriorityTaskTitle('Замена #фелиз фотографий'), {
    project: null,
    projectOffset: 0,
    title: 'Замена #фелиз фотографий',
    titleOffset: 0,
  })
})

test('supports Cyrillic, Latin letters, numbers, underscores, and hyphens', () => {
  assert.deepEqual(parsePriorityTaskTitle('#gelb-online_2  Подготовить урок'), {
    project: 'gelb-online_2',
    projectOffset: 1,
    title: 'Подготовить урок',
    titleOffset: 16,
  })
  assert.deepEqual(parsePriorityTaskTitle('#фелиз'), {
    project: 'фелиз',
    projectOffset: 1,
    title: '',
    titleOffset: 6,
  })
})

test('assigns the same color to equal normalized project names and distributes other names', () => {
  assert.equal(priorityProjectHue('Фелиз'), priorityProjectHue('фелиз'))
  assert.deepEqual(priorityProjectBadgeStyle('Ｆｅｌｉｚ'), priorityProjectBadgeStyle('feliz'))

  const hues = ['фелиз', 'gelb', 'mantra', 'tommma'].map(priorityProjectHue)
  assert.equal(new Set(hues).size, hues.length)
})
