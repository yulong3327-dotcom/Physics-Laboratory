"""Split the supplied ordered TTS WAV into the 32 verified lesson cues.

Usage: python scripts/split_voice.py SOURCE.wav
The source recording stays outside the repository. No third-party packages needed.
"""

from array import array
import json
import sys
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CUES = json.loads((ROOT / "src" / "voiceCues.json").read_text(encoding="utf-8"))
OUTPUT = ROOT / "public" / "voice"

# Checked against silence valleys and per-segment Chinese speech recognition.
CUTS = [
    0, 6.96, 12.04, 17.82, 26.05, 32.255, 38.24, 47.095, 55.16,
    62.34, 69.07, 75.51, 82.09, 88.67, 95.02, 101.39, 110.08,
    115.275, 121.45, 128.035, 135.11, 141.53, 148.19, 154.89,
    161.18, 167.34, 174.675, 181.97, 188.74, 194.34, 202.47,
    209.45, 219.883,
]


def main() -> None:
    source_path = Path(sys.argv[1])
    with wave.open(str(source_path), "rb") as source:
        assert source.getnchannels() == 1 and source.getsampwidth() == 2
        rate = source.getframerate()
        samples = array("h")
        samples.frombytes(source.readframes(source.getnframes()))

    assert len(CUTS) == len(CUES) + 1
    assert abs(CUTS[-1] - len(samples) / rate) < .01
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for index, cue in enumerate(CUES):
        start = round(CUTS[index] * rate)
        end = round(CUTS[index + 1] * rate)
        with wave.open(str(OUTPUT / f'{cue["id"]}.wav'), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate // 2)
            output.writeframes(samples[start:end:2].tobytes())
        print(f'{cue["id"]}: {CUTS[index]:.2f}-{CUTS[index + 1]:.2f}s {cue["text"]}')


if __name__ == "__main__":
    main()
