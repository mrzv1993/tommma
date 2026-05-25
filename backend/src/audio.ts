const audioFilenameExtensions: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'application/octet-stream': 'webm',
}

export function getAudioFilenameExtension(contentType: string) {
  const normalizedContentType = contentType.toLowerCase().split(';')[0]?.trim() || 'application/octet-stream'
  return audioFilenameExtensions[normalizedContentType] || 'webm'
}
