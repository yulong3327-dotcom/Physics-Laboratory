"""Physics pronunciation must retain exact source/cue and audio cache contracts."""
import json
from pathlib import Path
import tempfile
import wave
import unittest
from unittest.mock import patch
import pipeline


class PhysicsPronunciationTest(unittest.TestCase):
    def normalize(self,source):
        spoken,origins=pipeline.pronunciation_text(source)
        self.assertEqual(len(spoken),len(origins))
        self.assertEqual(len(origins),len(origins.ends))
        self.assertTrue(all(0<=a<b<=len(source) for a,b in zip(origins,origins.ends)))
        self.assertEqual(sorted(origins),list(origins))
        self.assertEqual(sorted(origins.ends),origins.ends)
        return spoken,origins

    def test_units_in_numeric_and_explicit_unit_context_without_rewriting_words(self):
        examples={
            'R₁=4Ω，I=2A，U=16V，P=32W。':'R 一等于4欧姆，I等于2安培，U等于16伏特，P等于32瓦特。',
            '8欧、2安、16伏、32瓦。':'8欧姆、2安培、16伏特、32瓦特。',
            '8欧姆、2安培、16伏特、32瓦特。':'8欧姆、2安培、16伏特、32瓦特。',
            '电流单位是A，电压单位是V，功率单位是W。':'电流单位是安培，电压单位是伏特，功率单位是瓦特。',
            '500mA，2kΩ，3.5kW。':'500毫安培，2千欧姆，3.5千瓦特。',
            'AI、CPU与WiFi；A=B。':'AI、CPU与WiFi；A等于B。',
            '量纲上A×Ω等于V，数值和单位都符合欧姆定律，因此电阻两端的电压为12 V。':'量纲上安培乘欧姆等于伏特，数值和单位都符合欧姆定律，因此电阻两端的电压为12 伏特。',
            '单位换算结束，A=V。':'单位换算结束，A等于V。',
        }
        for source,expected in examples.items():
            with self.subTest(source=source):self.assertEqual(self.normalize(source)[0],expected)

    def test_subscripts_powers_products_fractions_and_ratios(self):
        examples={
            'P1等于UI，求R2':'P 一等于U乘I，求R 二',
            'P等于UI，还等于I方R、U方除以R。':'P等于U乘I，还等于I 的平方乘R、U 的平方除以R。',
            'P=I²R=2^2×8=32W':'P等于I的平方乘R等于2的平方乘8等于32瓦特',
            'R_12，I⁻¹，U^{3}，P_1:P_2=1:3':'R 12，I的负一次方，U的立方，P 一比P 二等于1比3',
            r'P=\frac{U^2}{R}':'P等于U的平方除以R',
            r'P=U\frac{U}{R}':'P等于U乘U除以R',
            r'\frac12:\frac15:\frac1{10}=5:2:1':'1除以2比1除以5比1除以10等于5比2比1',
            r'\frac{U+I}{R_1+R_2}':'括号U加I括号除以括号R 一加R 二括号',
            r'R_{1}=10\,\Omega，I_2=500\,\mathrm{mA}':'R 一等于10 欧姆，I 二等于500 毫安培',
        }
        for source,expected in examples.items():
            with self.subTest(source=source):self.assertEqual(self.normalize(source)[0],expected)

    def test_provider_ranges_preserve_unit_and_tex_keyword_times(self):
        source=r'先求P=\frac{U^2}{R}，电流2A，功率32W。'
        spoken,origins=self.normalize(source)
        boundaries=[]
        for i,char in enumerate(spoken):
            if char.isspace() or char in '，。':continue
            boundaries.append(pipeline.source_boundary(source,origins,i,i+1,i*.21,.21))
        for phrase,spoken_token in [(r'\frac','U'),('U^2','U'),('R}','R'),('A','安'),('W','瓦')]:
            with self.subTest(phrase=phrase):
                expected=spoken.index(spoken_token)*.21
                actual=pipeline.resolve_cue({'phrase':phrase},source,boundaries,len(spoken)*.21)
                self.assertAlmostEqual(actual,expected)
        subtitles=pipeline.make_subtitles(source,boundaries,len(spoken)*.21,max_chars=15)
        self.assertEqual(''.join(s['text'] for s in subtitles),source)
        self.assertTrue(all(a['end']<=b['start'] for a,b in zip(subtitles,subtitles[1:])))

    def test_custom_dictionary_takes_precedence_and_has_complete_source_ranges(self):
        source='I=2A，电阻8Ω。'
        spoken,origins=pipeline.pronunciation_text(source,{'2A':'两安培','Ω':'欧姆'})
        self.assertEqual(spoken,'I等于两安培，电阻8欧姆。')
        word=spoken.index('两安培')
        event=pipeline.source_boundary(source,origins,word,word+3,1.234,.5)
        self.assertEqual(event['text'],'2A')
        self.assertEqual(pipeline.resolve_cue({'phrase':'2A'},source,[event],3),1.234)

    def test_measured_speech_splits_never_reparse_truncated_tex_or_lose_text(self):
        source=r'功率P=\frac{U^2}{R}=32\,\mathrm{W}。'
        spoken,origins=self.normalize(source)
        spans=pipeline.measured_segments(source,[{'phrase':r'\frac'},{'phrase':'R}'}],max_chars=8)
        fragments=[pipeline.spoken_segment(spoken,origins,s['start'],s['end']) for s in spans]
        self.assertEqual(''.join(fragments),spoken)
        self.assertNotIn('\\',''.join(fragments))
        segments=[];offset=0
        for span,fragment in zip(spans,fragments):
            duration=.8 if fragment.strip() else 0
            segments.append({'text':span['text'],'textOffset':span['start'],'offset':offset,'duration':duration});offset+=duration
        captions=pipeline.measured_subtitles(segments)
        self.assertEqual(''.join(c['text'] for c in captions),source)
        self.assertTrue(all(c['end']>c['start'] for c in captions))
        for cue in [{'phrase':r'\frac'},{'phrase':'R}'}]:
            self.assertGreaterEqual(pipeline.measured_cue(cue,source,segments,offset),0)

    def test_fish_requests_spoken_fragments_and_preserves_silent_source_delimiters(self):
        source=r'P=\frac{U^2}{R}=32\,\mathrm{W}。'
        utterance={'id':'u','speakerId':'teacher','text':source}
        speaker={'id':'teacher','voice':'local-fixture'}
        options={'provider':'fish','model':'s2-pro','chunkLength':200}
        requested=[]
        def generate(fragment,voice,options,path):
            self.assertTrue(fragment.strip())
            self.assertNotIn('\\',fragment)
            requested.append(fragment);Path(path).write_bytes(b'fixture')
        def normalize(source,target):
            with wave.open(str(target),'wb') as wav:
                wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(b'\0\0'*2400)
            return .1
        cues=[{'phrase':'frac'},{'phrase':'R}'}]
        with tempfile.TemporaryDirectory() as directory,patch('pipeline.fish_generate',side_effect=generate),patch('pipeline.normalize_audio',side_effect=normalize):
            metadata=pipeline.speech(utterance,speaker,Path(directory)/'out',Path(directory)/'cache',options=options,cues=cues)
        self.assertEqual(''.join(s['text'] for s in metadata['segments']),source)
        self.assertEqual(''.join(s['spokenText'] for s in metadata['segments']),metadata['spokenText'])
        self.assertEqual(''.join(c['text'] for c in pipeline.measured_subtitles(metadata['segments'])),source)
        self.assertEqual(pipeline.measured_cue(cues[0],source,metadata['segments'],metadata['duration']),.1)
        self.assertTrue(any('U的平方除以' in fragment for fragment in requested))

    def test_cache_version_invalidates_old_audio_even_for_unchanged_plain_text(self):
        utterance={'id':'u','speakerId':'teacher','text':'测试。'}
        speaker={'id':'teacher','voice':'zh-CN-YunyangNeural'}
        options={'provider':'edge','model':'edge','chunkLength':200}
        records=[{'kind':'WordBoundary','text':'测试','offset':.1,'duration':.5}]
        def normalize(source,target):
            with wave.open(str(target),'wb') as audio:
                audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000);audio.writeframes(b'\0\0'*19200)
            return .8
        with tempfile.TemporaryDirectory() as directory,patch('pipeline.edge_generate',return_value=records) as generate,patch('pipeline.normalize_audio',side_effect=normalize):
            out=Path(directory)/'out';cache=Path(directory)/'cache'
            first=pipeline.speech(utterance,speaker,out,cache,options=options)
            cached=pipeline.speech(utterance,speaker,out,cache,options=options)
            self.assertEqual(first['cacheKey'],cached['cacheKey']);self.assertEqual(generate.call_count,1)
            with patch('pipeline.PRONUNCIATION_VERSION','test-next-version'):
                changed=pipeline.speech(utterance,speaker,out,cache,options=options)
            self.assertNotEqual(first['cacheKey'],changed['cacheKey']);self.assertEqual(generate.call_count,2)
            self.assertEqual(changed['text'],utterance['text'])
            self.assertIn('spokenTextEnds',changed)

    def test_malformed_or_unknown_tex_is_actionable_instead_of_reading_markup(self):
        for source in [r'\frac{1}{',r'\unsupported{P}']:
            with self.subTest(source=source),self.assertRaisesRegex(ValueError,'朗读'):
                pipeline.pronunciation_text(source)


if __name__=='__main__':unittest.main()
