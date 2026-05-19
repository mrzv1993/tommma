export type PlanTreeElement = {
  title: string
  completed: boolean
  note?: string
  children?: PlanTreeElement[]
}

export function filterIncompletePlanTree(elements: PlanTreeElement[]): PlanTreeElement[] {
  return elements.flatMap((element) => {
    const children = filterIncompletePlanTree(element.children || [])
    if (children.length) {
      return [
        {
          ...element,
          children,
        },
      ]
    }
    if (!element.children?.length && !element.completed) {
      return [
        {
          ...element,
          children: [],
        },
      ]
    }
    return []
  })
}

export function formatPlanTree(elements: PlanTreeElement[], depth = 0): string[] {
  return elements.flatMap((element) => {
    const prefix = `${'  '.repeat(depth)}-`
    const title = element.title.trim() || 'Без названия'
    const line = element.children?.length
      ? `${prefix} ${title}`
      : `${prefix} [${element.completed ? 'x' : ' '}] ${title}`
    const note = element.note?.trim()
    const noteLines = note ? [`${'  '.repeat(depth + 1)}Примечание: ${note}`] : []
    return [line, ...noteLines, ...formatPlanTree(element.children || [], depth + 1)]
  })
}
