"""Summary layout intent, kept in sync with server/videoSummary.ts."""
import re


def is_summary_heading(text):
    return isinstance(text, str) and bool(re.search(r'总结|小结|回顾|复盘|\b(?:summary|recap)\b', text, re.I | re.ASCII))


def resolve_shot_template(shot):
    template = (shot.get('layout') or {}).get('template', 'auto')
    if template == 'summary' or is_summary_heading(shot.get('title')) or is_summary_heading(shot.get('sectionTitle')):
        return 'summary'
    return template if template not in ['auto', 'question'] else 'explain'


def summary_shot_ids(project):
    indices = {line['id']: index for index, line in enumerate(project.get('utterances', []))}
    boundaries = []
    for order, note in enumerate(project.get('scriptNotes') or []):
        if note.get('kind') not in ['chapter', 'summary'] or note.get('utteranceId') not in indices:
            continue
        index = indices[note['utteranceId']] + (1 if note.get('placement') == 'after' else 0)
        boundaries.append((index, note.get('sourceLine', 0), order,
                           note['kind'] == 'summary' or is_summary_heading(note.get('text'))))
    boundaries.sort(key=lambda value: value[:3])
    result, boundary, structural_summary, heading_section = set(), 0, False, None
    for shot in project['shots']:
        first = next((indices[uid] for uid in shot.get('utteranceIds', []) if uid in indices), None)
        while first is not None and boundary < len(boundaries) and boundaries[boundary][0] <= first:
            structural_summary = boundaries[boundary][3]
            boundary += 1
            heading_section = None
        section_title = (shot.get('sectionTitle') or '').strip()
        if heading_section is not None and (shot.get('chapter') != heading_section[0] or
                section_title and heading_section[1] and section_title != heading_section[1]):
            heading_section = None
        if is_summary_heading(shot.get('title')) or is_summary_heading(shot.get('sectionTitle')):
            heading_section = (shot.get('chapter'), section_title)
        if (shot.get('layout') or {}).get('template') == 'summary' or structural_summary or heading_section is not None:
            result.add(shot['id'])
    return result


def normalize_summary_project(project):
    ids = summary_shot_ids(project)
    return {**project, 'shots': [{**shot, 'layout': {**(shot.get('layout') or {}),
            'template': 'summary', 'elements': (shot.get('layout') or {}).get('elements') or {}}}
            if shot['id'] in ids else shot for shot in project['shots']]}
