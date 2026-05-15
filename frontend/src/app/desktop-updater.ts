import { ref } from 'vue'

type StatusMessages = {
  clearMessages: () => void
  setError: (message: string) => void
  setPersistentSuccess: (message: string) => void
  setSuccess: (message: string) => void
}

export function useDesktopUpdater(messages: StatusMessages) {
  const updaterBusy = ref(false)

  async function handleDesktopUpdate() {
    if (updaterBusy.value) return
    updaterBusy.value = true
    messages.clearMessages()

    try {
      const [{ check }, { relaunch }] = await Promise.all([
        import('@tauri-apps/plugin-updater'),
        import('@tauri-apps/plugin-process'),
      ])

      messages.setPersistentSuccess('Проверяю обновления...')
      const update = await check()
      if (!update) {
        messages.setSuccess('Обновлений нет')
        return
      }

      let downloadedBytes = 0
      messages.setPersistentSuccess(`Загружаю обновление ${update.version}...`)
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          downloadedBytes = 0
          messages.setPersistentSuccess('Скачиваю обновление...')
        }

        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength
          if (downloadedBytes > 0) {
            messages.setPersistentSuccess(`Скачиваю обновление: ${Math.round(downloadedBytes / 1024 / 1024)} МБ`)
          }
        }

        if (event.event === 'Finished') {
          messages.setPersistentSuccess('Устанавливаю обновление...')
        }
      })

      messages.setPersistentSuccess('Обновление установлено. Перезапускаю...')
      await relaunch()
    } catch (error) {
      messages.setError(error instanceof Error ? error.message : 'Не удалось обновить приложение')
    } finally {
      updaterBusy.value = false
    }
  }

  return {
    handleDesktopUpdate,
    updaterBusy,
  }
}
