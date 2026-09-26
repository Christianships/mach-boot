#!/usr/bin/env python3
"""Build the strike screen's soundtrack -> screens/strike/sound.wav.
Real CC0 recordings from Freesound (sources/, see CREDITS.txt): F-15 flyover, sonic boom.
TNT fuse + explosion come from the local Minecraft install. Needs ffmpeg.
Timings mirror the T table in mach.js. Run via `./mach build strike`."""
import glob
import json
import math
import os
import random
import subprocess
import tempfile
import wave
from array import array

SR = 44100
TAU = 2 * math.pi
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
SOURCES = os.path.join(HERE, "sources")
MC_ASSETS = os.path.expanduser("~/Library/Application Support/minecraft/assets")
MASTER = 0.19  # fixed output gain (not peak-normalized), so each sound's level below is absolute

T = dict(ACQ=0.6, LOCK=1.3, REL=2.2, IMP=3.7, BDA=4.0, OUT=5.8, END=6.4)
JET_PASS = T["REL"] + (0.5 - 0.3) / 1.1  # jet crosses screen center (jetPos in mach.js)
BOOM_AT = JET_PASS + 0.1   # boom lands just after the jet crosses overhead
FLYBY_PEAK = 7.5           # jet arrives overhead in the F-15 flyover recording
BOOM_ONSET = 0.64          # first shock crack in the boom recording


def lp(fc):
    return 1 - math.exp(-TAU * fc / SR)


def gains(pan):
    a = (max(-1.0, min(1.0, pan)) + 1) * math.pi / 4
    return math.cos(a), math.sin(a)


class Track:
    def __init__(self, dur):
        self.n = int(dur * SR)
        self.L = [0.0] * self.n
        self.R = [0.0] * self.n

    def put(self, i, v, gl=0.707, gr=0.707):
        if 0 <= i < self.n:
            self.L[i] += v * gl
            self.R[i] += v * gr

    def reverb(self, wet):
        for ch, spread in ((self.L, 0), (self.R, 23)):
            dry = ch[:]
            acc = [0.0] * self.n
            for ms in (29.7, 37.1, 41.1, 43.7):
                d = int(ms / 1000 * SR) + spread
                buf = [0.0] * self.n
                for i in range(self.n):
                    buf[i] = dry[i] + (0.78 * buf[i - d] if i >= d else 0.0)
                for i in range(self.n):
                    acc[i] += buf[i] * 0.25
            for ms in (5.0, 1.7):
                d = int(ms / 1000 * SR)
                out = [0.0] * self.n
                for i in range(self.n):
                    xd = acc[i - d] if i >= d else 0.0
                    yd = out[i - d] if i >= d else 0.0
                    out[i] = -0.7 * acc[i] + xd + 0.7 * yd
                acc = out
            for i in range(self.n):
                ch[i] = dry[i] + acc[i] * wet

    def write(self, name):
        g = MASTER
        fade = int(0.1 * SR)
        data = array("h")
        for i in range(self.n):
            f = min(1.0, (self.n - i) / fade)
            data.append(int(max(-1, min(1, self.L[i] * g * f)) * 32767))
            data.append(int(max(-1, min(1, self.R[i] * g * f)) * 32767))
        path = os.path.join(OUT, name)
        with wave.open(path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(data.tobytes())
        print("wrote", path)


def minecraft_sound(name):
    """Path of a sound in the user's own Minecraft install (Mojang assets: used locally, never copied)."""
    idx = max(glob.glob(os.path.join(MC_ASSETS, "indexes", "*.json")), key=os.path.getmtime)
    h = json.load(open(idx))["objects"][f"minecraft/sounds/{name}.ogg"]["hash"]
    return os.path.join(MC_ASSETS, "objects", h[:2], h)


def load(path):
    """Decode a recording (ffmpeg) -> peak-normalized (left, right) float lists at SR."""
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "x.wav")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "2", "-ar", str(SR), out], check=True)
        with wave.open(out) as w:
            raw = array("h", w.readframes(w.getnframes()))
            ch = w.getnchannels()
    left = [raw[i] / 32768 for i in range(0, len(raw), ch)]
    right = [raw[i] / 32768 for i in range(ch - 1, len(raw), ch)]
    peak = max(max(map(abs, left)), max(map(abs, right))) or 1.0
    return [x / peak for x in left], [x / peak for x in right]


def lay(tr, clip, src0, dst0, dur, gain, fade_in, fade_out):
    """Copy clip[src0 : src0+dur] into the track at dst0 with linear fades."""
    left, right = clip
    s0, d0 = int(src0 * SR), int(dst0 * SR)
    for k in range(int(dur * SR)):
        j, i = s0 + k, d0 + k
        if not (0 <= j < len(left) and 0 <= i < tr.n):
            continue
        t = k / SR
        env = gain * min(1.0, t / fade_in) * min(1.0, (dur - t) / fade_out)
        tr.L[i] += left[j] * env
        tr.R[i] += right[j] * env


def main():
    tr = Track(T["END"] + 0.5)
    rnd = random.Random(5)

    # --- real jet: approach, overhead pass (aligned to the jet crossing screen center), fade away
    flyby = load(os.path.join(SOURCES, "f15-flyover_klangfabrik_324370.mp3"))
    start = 0.8
    lay(tr, flyby, FLYBY_PEAK - JET_PASS + start, start, 3.9, 0.01, fade_in=0.8, fade_out=1.6)

    # --- real sonic boom right after the pass
    boom = load(os.path.join(SOURCES, "sonic-boom_qubodup_182050.mp3"))
    lay(tr, boom, BOOM_ONSET - 0.08, BOOM_AT - 0.08, 3.0, 0.02, fade_in=0.02, fade_out=1.3)

    # --- weapon release: pylon clunk + ejector thump, then a quiet falling whoosh
    rel = T["REL"]
    ph = 0.0
    for i in range(int(0.25 * SR)):
        t = i / SR
        ph += (95 * math.exp(-t / 0.05) + 55) / SR
        v = math.sin(TAU * ph) * math.exp(-t / 0.07) * 0.35
        if t < 0.004:
            v += rnd.uniform(-1, 1) * 0.25
        tr.put(int((rel + t) * SR), v, *gains(-0.5))
    y1 = y2 = 0.0
    for i in range(int((rel + 0.2) * SR), int(T["IMP"] * SR)):
        t = i / SR
        p = (t - rel - 0.2) / (T["IMP"] - rel - 0.2)
        n = rnd.uniform(-1, 1)
        y1 += lp(400 + 1400 * p) * (n - y1)
        y2 += lp(200 + 600 * p) * (n - y2)
        tr.put(i, (y1 - y2) * 0.14 * p * p * min(1.0, (T["IMP"] - t) / 0.01))

    # --- lit-TNT fuse hiss while it falls, then the TNT blast (from the local Minecraft install)
    fuse = load(minecraft_sound("random/fuse"))
    lay(tr, fuse, 0.0, T["REL"] + 0.05, T["IMP"] - T["REL"] - 0.05, 0.1, fade_in=0.02, fade_out=0.03)
    lay(tr, load(minecraft_sound("random/explode1")), 0.0, T["IMP"], 4.0, 0.3, fade_in=0.001, fade_out=0.3)

    tr.reverb(0.08)
    tr.write("sound.wav")


if __name__ == "__main__":
    main()
