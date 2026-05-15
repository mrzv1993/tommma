import { ref } from 'vue'

export function useStatusMessages() {
  const errorText = ref('')
  const successText = ref('')
  let successMessageTimeout: number | null = null

  function setError(message: string) {
    errorText.value = message
    successText.value = ''
  }

  function setSuccess(message: string) {
    successText.value = message
    errorText.value = ''
    clearSuccessMessageTimeout()
    successMessageTimeout = window.setTimeout(() => {
      successText.value = ''
      successMessageTimeout = null
    }, 3000)
  }

  function setPersistentSuccess(message: string) {
    clearSuccessMessageTimeout()
    successText.value = message
    errorText.value = ''
  }

  function clearMessages() {
    clearSuccessMessageTimeout()
    errorText.value = ''
    successText.value = ''
  }

  function clearSuccessMessageTimeout() {
    if (!successMessageTimeout) return
    window.clearTimeout(successMessageTimeout)
    successMessageTimeout = null
  }

  return {
    clearMessages,
    clearSuccessMessageTimeout,
    errorText,
    setError,
    setPersistentSuccess,
    setSuccess,
    successText,
  }
}
