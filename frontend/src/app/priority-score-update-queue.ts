export type PriorityScoreField = 'importance' | 'urgency' | 'overdue'

export type PriorityScoreValues = Record<PriorityScoreField, number>

type PriorityScoreUpdateQueueOptions = {
  initialValues: PriorityScoreValues
  persist: (values: PriorityScoreValues) => Promise<void>
  apply: (values: PriorityScoreValues) => void
  batchDelayMs?: number
}

function copyValues(values: PriorityScoreValues): PriorityScoreValues {
  return { ...values }
}

function valuesEqual(left: PriorityScoreValues, right: PriorityScoreValues) {
  return (
    left.importance === right.importance &&
    left.urgency === right.urgency &&
    left.overdue === right.overdue
  )
}

function wait(delayMs: number) {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

export class PriorityScoreUpdateQueue {
  private readonly options: PriorityScoreUpdateQueueOptions
  private desired: PriorityScoreValues
  private confirmed: PriorityScoreValues
  private operation: Promise<void> | null = null

  constructor(options: PriorityScoreUpdateQueueOptions) {
    this.options = options
    this.desired = copyValues(options.initialValues)
    this.confirmed = copyValues(options.initialValues)
  }

  get desiredValues() {
    return copyValues(this.desired)
  }

  get isIdle() {
    return this.operation === null
  }

  update(field: PriorityScoreField, value: number): Promise<void> {
    this.desired = { ...this.desired, [field]: value }
    this.options.apply(this.desiredValues)

    if (!this.operation) {
      const operation = this.drain()
      this.operation = operation
      operation.then(
        () => {
          if (this.operation === operation) this.operation = null
        },
        () => {
          if (this.operation === operation) this.operation = null
        },
      )
    }

    return this.operation!
  }

  reapplyDesiredValues() {
    this.options.apply(this.desiredValues)
  }

  private async drain() {
    while (!valuesEqual(this.desired, this.confirmed)) {
      await wait(this.options.batchDelayMs ?? 100)
      if (valuesEqual(this.desired, this.confirmed)) continue

      const sent = this.desiredValues
      try {
        await this.options.persist(sent)
      } catch (error) {
        this.desired = copyValues(this.confirmed)
        this.options.apply(this.desiredValues)
        throw error
      }

      this.confirmed = sent
      this.options.apply(this.desiredValues)
    }
  }
}
