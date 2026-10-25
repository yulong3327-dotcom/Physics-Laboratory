import re
import subprocess
import struct
import time
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(__file__).resolve().parent.parent
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)

def adb(*args):
    return subprocess.check_output(['adb', *args]).decode('utf8', errors='replace')

def snapshot(name):
    png = subprocess.check_output(['adb', 'exec-out', 'screencap', '-p'])
    (artifacts / f'android-{name}.png').write_bytes(png)
    return struct.unpack('>II', png[16:24])

def wait_text(text):
    for _ in range(20):
        adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
        xml = adb('shell', 'cat', '/sdcard/window.xml')
        (artifacts / 'android-window.xml').write_text(xml, encoding='utf8')
        if text in xml:
            return ET.fromstring(xml)
        time.sleep(1)
    snapshot('failure')
    raise AssertionError(f'Android view missing: {text}')

try:
    adb('install', '-r', str(root / 'releases/jingzhun-ai-lab.apk'))
    adb('shell', 'svc', 'wifi', 'disable')
    adb('shell', 'svc', 'data', 'disable')
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-n', 'com.jingzhunxue.ailab/.MainActivity')
    tree = wait_text('进入凸透镜实验')
    width, height = snapshot('home-offline')
    assert width < height, 'Home must be portrait'
    button = next(n for n in tree.iter('node') if '进入凸透镜实验' in (n.get('text', '') + n.get('content-desc', '')))
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', button.get('bounds')))
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    wait_text('放置平行光源')
    time.sleep(2)
    width, height = snapshot('lesson-landscape-offline')
    assert width > height, 'Lesson must switch to landscape'
    adb('shell', 'input', 'keyevent', '4')
    wait_text('进入凸透镜实验')
    time.sleep(2)
    width, height = snapshot('returned-home')
    assert width < height, 'Returning home must restore portrait'
    print('PASS: signed APK installs, opens offline, enters the lesson and returns home.')
finally:
    logs = adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'chromium:E', 'Capacitor:V')
    (artifacts / 'android-logcat.txt').write_text(logs, encoding='utf8')
