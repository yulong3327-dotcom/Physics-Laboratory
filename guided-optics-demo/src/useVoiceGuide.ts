import { useEffect, useRef, useState } from 'react'
import cues from './voiceCues.json'

const MUTE_KEY = 'guided-optics.voice-muted.v1'
const cueById = new Map(cues.map(cue => [cue.id, cue]))

export function introCue(step: number) {
  return ['01', '04', '07', '10', '11', '12', '16', '20', '30', '32'][step]
}

export function useVoiceGuide(initialId: string) {
  const [cueId, setCueId] = useState(initialId)
  const [open, setOpen] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(false)
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === 'true' } catch { return false }
  })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cueRef = useRef(initialId)
  const mutedRef = useRef(muted)
  const openRef = useRef(true)
  const playedRef = useRef(false)
  const playRequest = useRef(0)

  function audio() {
    if (!audioRef.current) {
      const element = new Audio()
      element.preload = 'none'
      element.onplaying = () => { setPlaying(true); setError(false); playedRef.current = true }
      element.onpause = () => setPlaying(false)
      element.onended = () => setPlaying(false)
      element.onerror = () => { setPlaying(false); setError(true) }
      audioRef.current = element
    }
    return audioRef.current
  }

  function play(id = cueRef.current) {
    if (mutedRef.current) return
    const element = audio()
    const url = new URL(`voice/${id}.wav`, document.baseURI).href
    if (element.src !== url) element.src = url
    element.currentTime = 0
    setError(false)
    start(element)
  }

  function start(element: HTMLAudioElement) {
    const request = ++playRequest.current
    void element.play().catch(() => { if (request === playRequest.current) setPlaying(false) })
  }

  function announce(id: string) {
    if (!cueById.has(id)) return
    cueRef.current = id
    openRef.current = true
    setCueId(id)
    setOpen(true)
    audioRef.current?.pause()
    play(id)
  }

  function togglePlay() {
    if (mutedRef.current) {
      toggleMute()
      return
    }
    const element = audio()
    if (!element.paused) element.pause()
    else {
      if (!element.src) element.src = new URL(`voice/${cueRef.current}.wav`, document.baseURI).href
      if (element.ended) element.currentTime = 0
      start(element)
    }
  }

  function toggleMute() {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    try { localStorage.setItem(MUTE_KEY, String(next)) } catch { /* Preference is optional. */ }
    if (next) audioRef.current?.pause()
    else play()
  }

  function close() {
    playRequest.current++
    openRef.current = false
    setOpen(false)
    audioRef.current?.pause()
  }

  function reopen() {
    openRef.current = true
    setOpen(true)
    play()
  }

  useEffect(() => {
    play(initialId)
    const unlock = (event: PointerEvent) => {
      if ((event.target as Element)?.closest('.mentor-controls')) return
      if (!playedRef.current && !mutedRef.current && openRef.current) {
        const element = audioRef.current
        if (element?.paused) start(element)
      }
      document.removeEventListener('pointerdown', unlock, true)
    }
    document.addEventListener('pointerdown', unlock, true)
    return () => {
      document.removeEventListener('pointerdown', unlock, true)
      audioRef.current?.pause()
    }
  }, [])

  return { cue: cueById.get(cueId)!, open, muted, playing, error, announce, togglePlay, toggleMute, close, reopen, replay: () => play() }
}

export type VoiceGuide = ReturnType<typeof useVoiceGuide>
