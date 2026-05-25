import assert from 'node:assert/strict'
import test from 'node:test'

import { getAudioFilenameExtension } from '../src/audio.ts'

test('audio filename extension matches supported OpenAI transcription formats', () => {
  assert.equal(getAudioFilenameExtension('audio/webm'), 'webm')
  assert.equal(getAudioFilenameExtension('audio/wav'), 'wav')
  assert.equal(getAudioFilenameExtension('audio/wave'), 'wav')
  assert.equal(getAudioFilenameExtension('audio/mpeg'), 'mp3')
  assert.equal(getAudioFilenameExtension('audio/mp4'), 'mp4')
  assert.equal(getAudioFilenameExtension('application/octet-stream'), 'webm')
})
