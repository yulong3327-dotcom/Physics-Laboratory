import { useEffect, useRef, useState } from 'react'
import curriculum from './curriculumVoice.json'
import legacy from './voiceCues.json'

export const voiceCatalogue=[
  ...curriculum.map(c=>({...c,audio:c.audio as string|null})),
  ...legacy.map(c=>({id:`old-${c.id}`,text:c.text,speech:c.script,file:`voice/${c.id}.wav`,audio:`voice/${c.id}.wav`})),
]
const cueById=new Map(voiceCatalogue.map(c=>[c.id,c]))
const MUTE_KEY='guided-optics.voice-muted.v1'
export function useVoiceGuide(initialId:string){
  const [cueId,setCueId]=useState(initialId),[open,setOpen]=useState(true),[playing,setPlaying]=useState(false),[error,setError]=useState(false)
  const [muted,setMuted]=useState(()=>{try{return localStorage.getItem(MUTE_KEY)==='true'}catch{return false}})
  const audioRef=useRef<HTMLAudioElement|null>(null),cueRef=useRef(initialId),mutedRef=useRef(muted),openRef=useRef(true),request=useRef(0),queue=useRef<string[]>([]),played=useRef(false)
  function show(id:string){cueRef.current=id;setCueId(id);setOpen(true);openRef.current=true;setError(false)}
  function play(id=cueRef.current){
    const serial=++request.current
    audioRef.current?.pause();setPlaying(false);setError(false)
    const src=cueById.get(id)?.audio
    if(!src||mutedRef.current||!openRef.current)return
    if(!audioRef.current){const a=new Audio();a.preload='none';audioRef.current=a}
    const a=audioRef.current
    a.onplaying=()=>{if(serial===request.current){setPlaying(true);played.current=true}}
    a.onpause=()=>setPlaying(false)
    a.onerror=()=>{if(serial===request.current){setPlaying(false);setError(true);queue.current=[]}}
    a.onended=()=>{if(serial!==request.current)return;setPlaying(false);const next=queue.current.shift();if(next){show(next);play(next)}}
    a.src=new URL(src,document.baseURI).href;a.currentTime=0
    void a.play().catch(()=>{if(serial===request.current)setPlaying(false)})
  }
  function announce(ids:string|string[]){
    const list=(Array.isArray(ids)?ids:[ids]).filter(id=>cueById.has(id))
    if(!list.length)return
    // Unrecorded lines remain text-only; do not request a missing file or play an unrelated clip.
    const first=list.findIndex(id=>!!cueById.get(id)?.audio)
    const start=first<0?list.length-1:first
    queue.current=list.slice(start+1)
    show(list[start]);play(list[start])
  }
  function toggleMute(){const next=!mutedRef.current;mutedRef.current=next;setMuted(next);try{localStorage.setItem(MUTE_KEY,String(next))}catch{/* Optional preference. */}if(next){request.current++;audioRef.current?.pause();setPlaying(false)}else play()}
  function close(){queue.current=[];request.current++;openRef.current=false;setOpen(false);audioRef.current?.pause();setPlaying(false)}
  function reopen(){openRef.current=true;setOpen(true);play()}
  useEffect(()=>{
    play(initialId)
    const unlock=(event:PointerEvent)=>{if((event.target as Element)?.closest('.mentor-controls'))return;if(!played.current&&openRef.current&&!mutedRef.current)play();document.removeEventListener('pointerdown',unlock,true)}
    document.addEventListener('pointerdown',unlock,true)
    return()=>{request.current++;document.removeEventListener('pointerdown',unlock,true);audioRef.current?.pause()}
  },[])
  return {cue:cueById.get(cueId)!,open,muted,playing,error,announce,toggleMute,close,reopen,replay:()=>{queue.current=[];play()}}
}
export type VoiceGuide=ReturnType<typeof useVoiceGuide>
