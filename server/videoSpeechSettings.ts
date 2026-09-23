import type { AIEnvironment } from './aiProxy.js'
import type { VideoSystemStatus } from './videoTypes.js'

/** Global readiness follows the formal Fish default; other providers stay inspectable. */
export function videoSpeechConfiguration(env: AIEnvironment, installed: { azure: boolean; edge: boolean }): Pick<VideoSystemStatus, 'azureConfigured' | 'fishConfigured' | 'missingConfiguration' | 'speechProviders' | 'messages'> {
  let proxyConfigured = false
  if (env.FISH_TTS_BASE_URL) {
    try { const url = new URL(env.FISH_TTS_BASE_URL); proxyConfigured = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { /* Show a configuration issue below. */ }
  }
  const fishConfigured = proxyConfigured || !!(env.FISH_API_KEY?.trim() || env.FISH_AUDIO_API_KEY?.trim())
  const azureMissing = ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'].filter(key => !env[key]?.trim())
  if (!installed.azure) azureMissing.push('azure-cognitiveservices-speech')
  const missingConfiguration = fishConfigured ? [] : ['FISH_TTS_BASE_URL 或 FISH_API_KEY']
  return { azureConfigured: azureMissing.length === 0, fishConfigured, missingConfiguration,
    messages: fishConfigured ? [] : ['正式配音默认使用 Fish s1，请配置 ' + missingConfiguration.join('、') + '。'],
    speechProviders: { fish: { configured: fishConfigured, missingConfiguration }, azure: { configured: azureMissing.length === 0, missingConfiguration: azureMissing },
      edge: { configured: installed.edge, missingConfiguration: installed.edge ? [] : ['edge-tts'] } } }
}
