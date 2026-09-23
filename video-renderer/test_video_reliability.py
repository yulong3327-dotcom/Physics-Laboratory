import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave
from copy import deepcopy
import pipeline
from video_preflight import preflight, static_check
from video_runtime import PipelineError, check_integrity, write_integrity


class ReliabilityTest(unittest.TestCase):
    def test_production_manifest_gate_checks_changed_state_wire_endpoints(self):
        from test_circuit import asset
        from video_validation import validate_manifest
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            manifest=self.manifest(directory,1)
            circuit=asset();circuit['geometry']['wires']=circuit['geometry']['wires'][:1]
            snapshot=deepcopy(circuit['geometry'])
            snapshot['wires'][0]['path']='M -49 0 L -80 0 L -80 50 L 50 50 L 50 0'
            manifest['project']['circuits']=[circuit]
            manifest['project']['shots'][0].update(circuitAssetId=circuit['id'],actions=[{'id':'open','type':'state','geometry':snapshot}])
            with patch('video_validation.validate_shot',return_value={'events':[],'duration':1}),patch('video_validation.validate_video'):
                with self.assertRaises(PipelineError):validate_manifest(manifest)
            report=pipeline.load(Path(manifest['outputDir'])/'validation.json')
            self.assertTrue(any('misses r.left' in error for error in report['errors']),report['errors'])

    def manifest(self, directory, count=2):
        project={'id':'p','revision':1,'title':'电学','settings':{'width':1920,'height':1080,'fps':24,'background':'#ffffff'},
                 'speakers':[{'id':'teacher','name':'方大招','voice':'v','color':'#4F80FF'}],
                 'speech':{'provider':'edge','model':'edge','chunkLength':200,'pauseSeconds':.2},'circuits':[],
                 'utterances':[{'id':f'u{i}','speakerId':'teacher','text':'电流相等。'} for i in range(count)],
                 'shots':[{'id':f's{i}','title':f'镜头{i}','utteranceIds':[f'u{i}'],'formulas':[],'actions':[],
                           'boardTexts':[{'id':f'b{i}','text':'电流相等','kind':'law'}],'highlights':[],'holdSeconds':1} for i in range(count)]}
        return {'project':project,'shots':[{'id':f's{i}','cacheKey':f'cache{i}'} for i in range(count)],
                'cacheDir':str(Path(directory)/'cache'),'outputDir':str(Path(directory)/'out'),'width':1280,'height':720,'fps':24}

    def test_seventeenth_static_failure_prevents_all_speech_and_drawing(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest=self.manifest(directory,17);calls=[]
            def worker(args,**kwargs):
                request=pipeline.load(args[args.index('--input')+1]);sid=request['shotId'];calls.append(sid)
                errors=[{'code':'highlight_not_visible','stage':'static_preflight','shotId':sid,'objectId':'f-old',
                         'message':'高亮对象已替换','severity':'error','retryable':False}] if sid=='s16' else []
                pipeline.save(args[args.index('--output')+1],{'status':'failed' if errors else 'passed','errors':errors,'warnings':[]})
            with patch('pipeline.run',side_effect=worker),patch('pipeline.build_timeline') as speech:
                with self.assertRaisesRegex(PipelineError,'高亮对象'):preflight(manifest)
                self.assertEqual(len(calls),17);speech.assert_not_called()
            report=pipeline.load(Path(manifest['outputDir'])/'preflight.json')
            self.assertEqual(report['errors'][0]['shotId'],'s16');self.assertFalse(report['errors'][0]['retryable'])

    def test_speech_failure_after_all_static_checks_stops_before_manim(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest=self.manifest(directory);order=[]
            def worker(args,**kwargs):
                order.append('static');pipeline.save(args[args.index('--output')+1],{'status':'passed','errors':[],'warnings':[]})
            def speech(project,shot,*args):
                order.append('speech:'+shot['id'])
                raise PipelineError('连接中断',code='speech_network',retryable=True)
            with patch('pipeline.run',side_effect=worker),patch('pipeline.build_timeline',side_effect=speech):
                with self.assertRaisesRegex(PipelineError,'连接中断'):preflight(manifest)
            self.assertEqual(order,['static','static','speech:s0'])
            self.assertTrue(pipeline.load(Path(manifest['outputDir'])/'preflight.json')['errors'][0]['retryable'])

    def test_checksum_rejects_same_size_corruption_in_one_shot_without_invalidating_another(self):
        with tempfile.TemporaryDirectory() as directory:
            first=Path(directory)/'one';second=Path(directory)/'two'
            for location in [first,second]:
                location.mkdir();(location/'video.mp4').write_bytes(b'good');write_integrity(location,['video.mp4'],pipeline.save)
            (first/'video.mp4').write_bytes(b'evil')
            self.assertFalse(check_integrity(first,['video.mp4']));self.assertTrue(check_integrity(second,['video.mp4']))

    def test_actual_static_layout_detects_replaced_formula_highlight(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            manifest=self.manifest(directory,1);project=manifest['project'];shot=project['shots'][0]
            project['utterances'][0]['text']='先写电流，再写功率，最后强调电流。'
            shot['formulas']=[{'id':'f1','latex':'I=U/R','action':'write','cue':{'utteranceId':'u0','phrase':'电流'}},
                              {'id':'f2','latex':'P=UI','action':'result','cue':{'utteranceId':'u0','phrase':'功率'}}]
            shot['highlights']=[{'id':'h','targetType':'formula','targetId':'f1','phrase':'I','effect':'box',
                                 'cue':{'utteranceId':'u0','phrase':'最后'}}]
            report=static_check(project,shot,Path(directory))
            self.assertEqual(report['status'],'failed');self.assertEqual(report['errors'][0]['objectId'],'f1')
            self.assertIn('已被替换',report['errors'][0]['message'])

    def test_corrupt_local_audio_repairs_only_affected_timeline_from_shared_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest=self.manifest(directory)
            manifest['project']['speech'].update(provider='fish',model='s2-pro')
            def worker(args,**kwargs):
                pipeline.save(args[args.index('--output')+1],{'status':'passed','errors':[],'warnings':[]})
            def generate(fragment,voice,options,path):Path(path).write_bytes(b'fixture')
            def normalize(source,target):
                with wave.open(str(target),'wb') as audio:
                    audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000);audio.writeframes(b'\x01\x00'*24000)
                return 1
            with patch('pipeline.run',side_effect=worker),patch('pipeline.fish_generate',side_effect=generate) as network,patch('pipeline.normalize_audio',side_effect=normalize):
                preflight(manifest)
                requests=network.call_count
                damaged=Path(manifest['cacheDir'])/'shots/cache0/audio/u0.wav'
                original=damaged.read_bytes();damaged.write_bytes(original[:-2]+b'\x02\x00')
                with patch('pipeline.build_timeline',wraps=pipeline.build_timeline) as rebuild:
                    report=preflight(manifest)
                    self.assertEqual(report['status'],'passed')
                    self.assertEqual([call.args[1]['id'] for call in rebuild.call_args_list],['s0'])
                self.assertEqual(network.call_count,requests)
                self.assertEqual(damaged.read_bytes(),original)


if __name__=='__main__':unittest.main()
