"""Preflight selected shots; the explicit course preflight keeps its static-first gate."""
from pathlib import Path
import json
import os
import sys
from video_runtime import PipelineError, check_integrity, write_integrity, watch_parent


def issue(error, stage, shot_id, object_id=None):
    return {'code':getattr(error,'code','invalid_content'),'stage':stage,'shotId':shot_id,
            'objectId':getattr(error,'object_id',object_id),'message':str(error),'severity':'error','retryable':getattr(error,'retryable',False)}


def static_check(project, shot, directory):
    from manim import tempconfig
    from scene_layout import SceneLayout
    from scene_preview import preview_events
    from video_validation import Audit, check_event_visibility, validate_state_geometry
    current_object = None
    try:
        timeline={'projectTitle':project['title'],'settings':project['settings'],'speakers':project['speakers'],
                  'shot':shot,'problem':project.get('problem'),'circuit':next((c for c in project['circuits'] if c['id']==shot.get('circuitAssetId')),None)}
        with tempconfig({'frame_width':128/9,'frame_height':8,'pixel_width':1920,'pixel_height':1080,'media_dir':str(directory),'verbosity':'ERROR'}):
            events=preview_events(project,shot);timeline['events']=events
            layout=SceneLayout(timeline,directory)
            formulas={}
            for step in shot['formulas']:
                current_object=step['id'];formulas[step['id']]=layout.create_formula(step)
            for item in shot.get('highlights',[]):
                current_object=item['targetId']
                target=(layout.boards if item['targetType']=='board' else formulas).get(item['targetId'])
                if target is None:raise ValueError('强调引用的对象不存在：'+current_object)
                target.phrase_regions(item['phrase'],item.get('occurrence',1))
            for action in shot.get('actions',[]):
                for target in action['targetIds']:
                    current_object=target
                    if layout.circuit is None:raise ValueError('电路动作缺少电路素材')
                    layout.circuit.resolve_target(target)
            for event in events:
                if event['kind']!='circuit':continue
                action=event['data'];current_object=action['id']
                if action['type']=='annotation':layout.create_circuit_annotation(action)
                elif action['type']=='state':
                    audit=Audit();validate_state_geometry(shot,action,audit,Path(directory)/'state-geometry-audit')
                    if audit.errors:raise ValueError('；'.join(audit.errors))
                    layout.replace_circuit_state(action)
            if not any(event['data'].get('cue',{}).get('offset',0) for event in events):
                check_event_visibility(shot,{'events':[{'type':event['kind'],'data':event['data']} for event in events]})
            return {'status':'passed','shotId':shot['id'],'warnings':layout.warnings,'errors':[]}
    except Exception as error:
        return {'status':'failed','shotId':shot['id'],'warnings':[],'errors':[issue(error,'static_preflight',shot['id'],current_object)]}


def preflight(manifest, static_only=False, on_progress=None):
    from pipeline import load,save,run,emit,build_timeline,concatenate_wav,write_srt,telemetry
    from video_validation import Audit, validate_shot, check_event_visibility
    from video_summary import normalize_summary_project
    progress = on_progress or emit
    manifest = {**manifest, 'project': normalize_summary_project(manifest['project'])}
    project=manifest['project'];output=Path(manifest['outputDir']);cache=Path(manifest['cacheDir'])
    output.mkdir(parents=True,exist_ok=True)
    report={'status':'failed','projectId':project['id'],'projectRevision':project['revision'],
            'rendererVersion':manifest.get('rendererVersion'),'shots':[],'errors':[],'warnings':[]}
    items=manifest['shots']; directories=[]
    def fail():
        report['metrics']=telemetry()
        save(output/'preflight.json',report)
        first=report['errors'][0]
        error=PipelineError(first['message'],code=first['code'],retryable=first['retryable'],stage=first['stage'],shot_id=first['shotId'])
        error.object_id=first.get('objectId');error.issues=report['errors'];raise error
    # Complete this pass for the whole course. A late formula error cannot spend
    # the preceding sixteen shots' speech or animation budget.
    for index,item in enumerate(items):
        shot=next(s for s in project['shots'] if s['id']==item['id']);directory=cache/'shots'/item['cacheKey'];directory.mkdir(parents=True,exist_ok=True)
        directories.append((shot,directory,item))
        progress(index/max(1,len(items))*12,f'静态预检 {index+1}/{len(items)}：{shot["title"]}',phase='static_preflight',shotId=shot['id'])
        try:
            if not check_integrity(directory,['static.json'],'static.complete.json'):
                request=directory/'static-input.json'
                save(request,{'project':project,'shotId':shot['id'],'directory':str(directory/'static-media')})
                # Share the same formula SVGs with the subsequent Manim pass.
                # Content-addressed TeX keys still change when formulas change.
                environment={**os.environ,'VIDEO_LATEX_CACHE_DIR':str(cache.resolve().parent/'latex-cache'),'PYTHONIOENCODING':'utf-8'}
                run([sys.executable,Path(__file__),'--input',request,'--output',directory/'static.json'],
                    env=environment,timeout=float(os.environ.get('VIDEO_STATIC_TIMEOUT_SECONDS','120')))
            result=load(directory/'static.json')
            report['errors'].extend(result.get('errors',[]));report['warnings'].extend({'shotId':shot['id'],'message':text} for text in result.get('warnings',[]))
            if result['status']=='passed':write_integrity(directory,['static.json'],save,'static.complete.json')
        except Exception as error:report['errors'].append(issue(error,'static_preflight',shot['id']))
    if report['errors']:fail()
    if static_only:
        report['status']='passed';save(output/'preflight.json',report);return report
    # Prepare every voice/timeline before starting the Manim render pass.
    for index,(shot,directory,item) in enumerate(directories):
        progress(12+index/max(1,len(items))*23,f'配音与时间轴 {index+1}/{len(items)}：{shot["title"]}',phase='speech_timeline',shotId=shot['id'])
        try:
            # Include source copies used by validation. Damage in one shot
            # rebuilds its timeline from verified shared speech fragments.
            names=['timeline.json','narration.wav','subtitles.srt']+[
                f'audio/{uid}.{extension}' for uid in shot['utteranceIds'] for extension in ('wav','json')]
            if not check_integrity(directory,names,'timeline.complete.json'):
                timeline=build_timeline(project,shot,{},directory,cache)
                save(directory/'timeline.json',timeline)
                pending=directory/'narration.pending.wav';concatenate_wav(timeline,pending);pending.replace(directory/'narration.wav')
                write_srt(timeline['subtitles'],directory/'subtitles.srt')
            audit=Audit();timeline=validate_shot(project,shot,directory,audit);check_event_visibility(shot,timeline)
            if audit.errors:raise PipelineError('；'.join(audit.errors[:6]),code='timeline_invalid',stage='timeline_preflight',shot_id=shot['id'])
            write_integrity(directory,names,save,'timeline.complete.json')
            report['warnings'].extend({'shotId':shot['id'],'message':message} for message in audit.warnings)
            report['shots'].append({**item,'duration':timeline['duration'],'timelinePath':str(directory/'timeline.json')})
            save(output/'preflight.json',report)
        except Exception as error:
            report['errors'].append(issue(error,'speech_timeline',shot['id']));fail()
    report['status']='passed';report['metrics']=telemetry();save(output/'preflight.json',report)
    progress(35,'所选镜头配音与时间轴预检通过',phase='preflight_complete')
    return report


if __name__=='__main__':
    import argparse
    from pipeline import load,save
    watch_parent()
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    request=load(args.input);shot=next(s for s in request['project']['shots'] if s['id']==request['shotId'])
    save(args.output,static_check(request['project'],shot,Path(request['directory'])))
