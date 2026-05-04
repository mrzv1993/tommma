export type DesktopTrayAction = 'open' | 'start-pause' | 'stop' | 'refresh'

export type DesktopTrayController = {
  setTimer(snapshot: { title: string; tooltip: string }): Promise<void>
  destroy(): void
}

export async function createDesktopTrayController(_options: {
  onAction: (action: DesktopTrayAction) => void
}): Promise<DesktopTrayController> {
  return {
    async setTimer() {
      return
    },
    destroy() {
      return
    },
  }
}
