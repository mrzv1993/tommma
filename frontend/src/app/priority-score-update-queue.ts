export type PriorityScoreField = 'importance' | 'urgency' | 'overdue'

export type PriorityScoreValues = Record<PriorityScoreField, number>

type PriorityScoreUpdateQueueOptions = {
  initialValues: PriorityScoreValues
  persist: (values: PriorityScoreValues) => Promise<void>
  apply: (values: PriorityScoreValues, pending: boolean) => void
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
  private inFlight: PriorityScoreValues | null = null
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
    this.applyDesiredValues()

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
    this.applyDesiredValues()
  }

  private applyDesiredValues() {
    this.options.apply(
      this.desiredValues,
      this.inFlight !== null || !valuesEqual(this.desired, this.confirmed),
    )
  }

  private async drain() {
    while (!valuesEqual(this.desired, this.confirmed)) {
      await wait(this.options.batchDelayMs ?? 100)
      if (valuesEqual(this.desired, this.confirmed)) continue

      const sent = this.desiredValues
      this.inFlight = sent
      try {
        await this.options.persist(sent)
      } catch (error) {
        this.inFlight = null
        this.desired = copyValues(this.confirmed)
        this.applyDesiredValues()
        throw error
      }

      this.confirmed = sent
      this.inFlight = null
      this.applyDesiredValues()
    }
  }
}
