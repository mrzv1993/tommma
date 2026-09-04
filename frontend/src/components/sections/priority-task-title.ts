const LEADING_PROJECT_TAG = /^#([\p{L}\p{N}][\p{L}\p{N}_-]*)(?:\s+|$)/u

export type PriorityTaskTitleParts = {
  project: string | null
  projectOffset: number
  title: string
  titleOffset: number
}

export function parsePriorityTaskTitle(rawTitle: string): PriorityTaskTitleParts {
  const match = rawTitle.match(LEADING_PROJECT_TAG)
  if (!match) {
    return {
      project: null,
      projectOffset: 0,
      title: rawTitle,
      titleOffset: 0,
    }
  }

  return {
    project: match[1],
    projectOffset: 1,
    title: rawTitle.slice(match[0].length),
    titleOffset: match[0].length,
  }
}

function normalizedProjectName(project: string) {
  return project.normalize('NFKC').toLocaleLowerCase('ru-RU')
}

export function priorityProjectHue(project: string) {
  let hash = 2_166_136_261
  for (const character of normalizedProjectName(project)) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % 360
}

export function priorityProjectBadgeStyle(project: string): Record<string, string> {
  const hue = priorityProjectHue(project)
  return {
    '--priority-project-bg': `hsl(${hue} 58% 91%)`,
    '--priority-project-border': `hsl(${hue} 42% 76%)`,
    '--priority-project-text': `hsl(${hue} 48% 27%)`,
  }
}
