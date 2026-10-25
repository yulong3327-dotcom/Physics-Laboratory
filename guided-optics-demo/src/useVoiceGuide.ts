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
  const audioRef=useRef<HTMLAudioElement|null>(null),cueRef=useRef(initialId),mutedRef=useRef(muted),openRef=useRef(true),request=useRef(0),queue=useRef<{id:string;feedback:boolean}[]>([]),played=useRef(false),busy=useRef(false)
  function show(id:string){cueRef.current=id;setCueId(id);setOpen(true);openRef.current=true;setError(false)}
  function play(id=cueRef.current){
    const serial=++request.current
    busy.current=false;audioRef.current?.pause();setPlaying(false);setError(false)
    const src=cueById.get(id)?.audio
    if(!src||mutedRef.current||!openRef.current)return
    if(!audioRef.current){const a=new Audio();a.preload='none';audioRef.current=a}
    const a=audioRef.current
    busy.current=true
    a.onplaying=()=>{if(serial===request.current){setPlaying(true);played.current=true}}
    a.onpause=()=>setPlaying(false)
    a.onerror=()=>{if(serial===request.current){busy.current=false;setPlaying(false);setError(true);queue.current=[]}}
    a.onended=()=>{if(serial!==request.current)return;busy.current=false;setPlaying(false);const next=queue.current.shift();if(next){show(next.id);play(next.id)}}
    a.src=new URL(src,document.baseURI).href;a.currentTime=0
    void a.play().catch(()=>{if(serial===request.current){busy.current=false;setPlaying(false)}})
  }
  function announce(ids:string|string[],options:{interrupt?:boolean;feedback?:boolean}={}){
    const list=(Array.isArray(ids)?ids:[ids]).filter(id=>cueById.has(id))
    if(!list.length)return
    // Unrecorded lines remain text-only; do not request a missing file or play an unrelated clip.
    const first=list.findIndex(id=>!!cueById.get(id)?.audio)
    const start=first<0?list.length-1:first
    const incoming=list.slice(start).map(id=>({id,feedback:!!options.feedback}))
    // Finish the current sentence; retain only the latest pending drag hint.
    if(busy.current&&!options.interrupt){
      queue.current=queue.current.filter(c=>!c.feedback)
      for(const cue of incoming)if(cue.id!==cueRef.current&&!queue.current.some(c=>c.id===cue.id))queue.current.push(cue)
      return
    }
    queue.current=incoming.slice(1)
    show(incoming[0].id);play(incoming[0].id)
  }
  function toggleMute(){const next=!mutedRef.current;mutedRef.current=next;setMuted(next);try{localStorage.setItem(MUTE_KEY,String(next))}catch{/* Optional preference. */}if(next){busy.current=false;request.current++;audioRef.current?.pause();setPlaying(false)}else play()}
  function close(){queue.current=[];busy.current=false;request.current++;openRef.current=false;setOpen(false);audioRef.current?.pause();setPlaying(false)}
  function stop(){queue.current=[];busy.current=false;request.current++;audioRef.current?.pause();setPlaying(false)}
  function reopen(){openRef.current=true;setOpen(true);play()}
  useEffect(()=>{
    play(initialId)
    const unlock=(event:PointerEvent)=>{if((event.target as Element)?.closest('.mentor-controls'))return;if(!played.current&&!busy.current&&openRef.current&&!mutedRef.current)play();document.removeEventListener('pointerdown',unlock,true)}
    const visibility=()=>{const a=audioRef.current;if(!a)return;if(document.hidden){a.pause();setPlaying(false)}else if(busy.current&&!mutedRef.current&&openRef.current)void a.play().catch(()=>{busy.current=false;setPlaying(false)})}
    document.addEventListener('pointerdown',unlock,true)
    document.addEventListener('visibilitychange',visibility)
    return()=>{busy.current=false;request.current++;document.removeEventListener('pointerdown',unlock,true);document.removeEventListener('visibilitychange',visibility);audioRef.current?.pause()}
  },[])
  return {cue:cueById.get(cueId)!,open,muted,playing,error,announce,toggleMute,close,reopen,stop,replay:()=>{queue.current=[];play()}}
}
export type VoiceGuide=ReturnType<typeof useVoiceGuide>
