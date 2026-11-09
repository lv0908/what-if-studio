"""Synthesize an original ambient score + sound design for an episode (numpy only, no samples).

    python3 soundtrack.py --project <episode dir> [--mood dark|hopeful|tense] \
        [--sfx "countdown+fireworks+crowd, monitor, wind, murmur, ticks, wind, ocean, rocket, shimmer"]

Scene lengths are read from TIMELINE in <project>/src/main.js, so music changes chord exactly on
each cut. --sfx is a comma-separated list, one entry per scene (use "-" for none, join several
with "+"). Writes <project>/media/soundtrack.wav and soundtrack.m4a (AAC, normalised to -16 LUFS).

SFX available: countdown, fireworks, crowd, murmur, monitor, heartbeat, wind, rain, thunder,
ticks, alarm, ocean, rocket, shimmer, boom.
"""
import argparse, os, re, subprocess, wave
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--project', default='.')
ap.add_argument('--mood', default='dark', choices=['dark', 'hopeful', 'tense'])
ap.add_argument('--sfx', default='')
ap.add_argument('--seed', type=int, default=7)
a = ap.parse_args()

main = open(os.path.join(a.project, 'src', 'main.js'), encoding='utf-8').read()
tl = main[main.index('TIMELINE'):main.index('];', main.index('TIMELINE'))]
DURS = [float(x) for x in re.findall(r'\bdur:\s*([\d.]+)', tl)]
assert DURS, 'no scene durations found in src/main.js TIMELINE'
SR = 48000
STARTS = np.concatenate([[0], np.cumsum(DURS)[:-1]])
TOTAL = float(sum(DURS)); N = int(TOTAL * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(a.seed)
L = np.zeros(N); R = np.zeros(N)


def env_seg(s, e, att=1.2, rel=1.2):
    up = np.clip((t - s) / att, 0, 1); dn = np.clip((e - t) / rel, 0, 1)
    return (0.5 - 0.5 * np.cos(np.pi * up)) * (0.5 - 0.5 * np.cos(np.pi * dn))


def band(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); m = np.ones_like(f)
    if lo > 0: m *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** 4)
    if hi < SR / 2: m *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * m, len(x))


def add(sig, start=0.0, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i < 0: sig = sig[-i:]; i = 0
    sig = sig[: max(0, N - i)]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * gain * l * 1.414; R[i:i + len(sig)] += sig * gain * r * 1.414


def tone(dur, f0, decay=6.0, f1=None):
    tt = np.arange(int(dur * SR)) / SR
    f = f0 if f1 is None else f0 * (f1 / f0) ** (tt / dur)
    return np.sin(2 * np.pi * np.cumsum(np.broadcast_to(f, tt.shape)) / SR) * np.exp(-tt * decay)


def noise_bed(s, d, lo, hi, gain, mod=0.2, rate=0.2):
    x = band(rng.standard_normal(N), lo, hi) * (1 - mod + mod * np.sin(2 * np.pi * rate * t + rng.random() * 6)) * env_seg(s - 0.3, s + d + 0.3, 1.0, 0.8)
    add(x, gain=gain)


# ---------- harmonic pad (chords cycle if there are more scenes than chords) ----------
def chord(root, *semis): return [root * 2 ** (x / 12) for x in semis]
A2, C2, D2, E2, F2, G2, Bb1 = 110.0, 65.41, 73.42, 82.41, 87.31, 98.0, 58.27
MOODS = {
    'dark': [chord(A2, 0, 7, 12, 15, 19), chord(F2, 0, 7, 12, 16, 19), chord(D2, 0, 7, 12, 15, 19), chord(A2, 0, 7, 12, 15, 19, 24),
             chord(E2, 0, 7, 12, 16, 17), chord(F2, 0, 7, 12, 16, 19), chord(C2, 0, 7, 12, 16, 19, 28), chord(G2, 0, 7, 12, 16, 19, 24)],
    'hopeful': [chord(C2 * 2, 0, 7, 12, 16, 19), chord(G2, 0, 7, 12, 16, 19), chord(A2, 0, 7, 12, 15, 19), chord(F2, 0, 7, 12, 16, 19, 24)],
    'tense': [chord(D2, 0, 7, 12, 15, 19), chord(Bb1 * 2, 0, 7, 12, 16, 19), chord(G2, 0, 7, 12, 15, 19), chord(A2, 0, 7, 12, 16, 19)],
}
FINAL = {'dark': chord(A2, 0, 7, 12, 14, 15, 19, 24), 'hopeful': chord(C2 * 2, 0, 7, 12, 14, 16, 19, 24), 'tense': chord(D2, 0, 7, 12, 14, 15, 19, 24)}[a.mood]
prog = MOODS[a.mood]
CH = [prog[k % len(prog)] for k in range(len(DURS) - 1)] + [FINAL]
for (s0, d, ch) in zip(STARTS, DURS, CH):
    w = env_seg(s0 - 0.6, s0 + d + 0.6, 1.4, 1.4)
    for j, f in enumerate(ch):
        for det, pan in [(-0.0018, -0.6), (0.0021, 0.6)]:
            ph = rng.random() * 6.28
            v = sum(np.sin(2 * np.pi * f * (1 + det) * h * t + ph * h) / h ** 1.6 for h in range(1, 6))
            add(v * w * (0.8 + 0.2 * np.sin(2 * np.pi * (0.13 + 0.05 * j) * t + ph)) / len(ch), gain=0.11, pan=pan * (0.3 + 0.1 * j))
    add(np.sin(2 * np.pi * ch[0] / 2 * t) * env_seg(s0 - 0.4, s0 + d + 0.4, 1.0, 1.0), gain=0.07)

# ---------- sound effects library (s = scene start, d = scene length) ----------
def sfx_countdown(s, d):
    for k in range(3):
        n = int(0.04 * SR); add(band(rng.standard_normal(n), 1500, 6000) * np.exp(-np.arange(n) / SR * 120), s + 0.02 + k, 0.5)
        add(tone(0.05, 2200, 80), s + 0.02 + k, 0.2)
    add(tone(2.2, 90, 2.2, 38), s + 3.0, 0.9)
def sfx_boom(s, d): add(tone(2.2, 90, 2.2, 38), s + 0.2, 0.8)
def sfx_fireworks(s, d):
    for i in range(16):
        t0 = s + 3.0 + i * 0.32 + rng.random() * 0.25
        if t0 > s + d: break
        add(tone(0.9, 70, 5, 45), t0, 0.3, rng.uniform(-0.7, 0.7))
        n = int(1.4 * SR); cr = np.zeros(n); idx = rng.integers(0, n, 160); cr[idx] = rng.uniform(-1, 1, 160) * np.exp(-idx / SR * 2)
        add(band(cr, 1800, 9000), t0 + 0.05, 0.5, rng.uniform(-0.8, 0.8))
def sfx_crowd(s, d):
    x = band(rng.standard_normal(N), 250, 2600) * env_seg(s + min(3.0, d / 3), s + d + 0.3, 0.7, 0.6) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.7 * t) * np.sin(2 * np.pi * 1.9 * t))
    add(x, gain=0.16)
def sfx_murmur(s, d): noise_bed(s, d, 180, 1400, 0.12, 0.2, 2.3)
def sfx_monitor(s, d):
    for b in np.arange(s + 0.4, s + d - 0.2, 0.83):
        add(np.sin(2 * np.pi * 988 * np.arange(int(0.09 * SR)) / SR) * np.hanning(int(0.09 * SR)), b, 0.06, -0.3)
def sfx_heartbeat(s, d):
    for b in np.arange(s + 0.3, s + d - 0.3, 0.9):
        add(tone(0.25, 60, 14), b, 0.5); add(tone(0.2, 55, 16), b + 0.22, 0.35)
def sfx_wind(s, d): noise_bed(s, d, 150, 1500, 0.08, 0.4, 0.21)
def sfx_rain(s, d): noise_bed(s, d, 1200, 9000, 0.06, 0.1, 0.5)
def sfx_thunder(s, d):
    n = int(3 * SR); tt = np.arange(n) / SR
    add(band(rng.standard_normal(n), 25, 300) * np.exp(-tt * 1.3) * (tt / 0.08).clip(0, 1), s + d * 0.4, 0.9)
def sfx_ticks(s, d):
    for b in np.arange(s + 0.3, s + d - 0.2, 0.25): add(tone(0.04, 1600, 90), b, 0.07, 0.2)
    for b in np.arange(s + 0.5, s + d - 0.5, 1.0): add(tone(0.5, 55, 6), b, 0.25)
def sfx_alarm(s, d):
    for b in np.arange(s + 0.3, s + d - 0.5, 1.1): add(tone(0.45, 880, 2, 660), b, 0.06)
def sfx_ocean(s, d):
    x = band(rng.standard_normal(N), 80, 1200) * (0.35 + 0.65 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.16 * t)) ** 2) * env_seg(s - 0.3, s + d + 0.3, 1.0, 0.8)
    add(x, gain=0.16)
def sfx_rocket(s, d):
    ign, lift = s + 1.0, s + 2.4
    r = band(rng.standard_normal(N), 20, 260) * np.clip((t - ign) / 1.6, 0, 1) ** 1.5 * env_seg(ign, s + d + 0.6, 0.05, 0.9)
    add(r * (1 + 4 * band(rng.standard_normal(N), 4, 25)), gain=0.9)
    add(band(rng.standard_normal(N), 900, 5000) * (rng.random(N) < 0.02) * np.clip((t - lift), 0, 1) * env_seg(lift, s + d + 0.2, 0.3, 0.6), gain=0.5)
def sfx_shimmer(s, d):
    x = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate([880, 1318.5, 1760, 987.8])) * env_seg(s + 2.5, TOTAL + 1, 2.5, 2.5) * (0.6 + 0.4 * np.sin(2 * np.pi * 3.1 * t))
    add(x, gain=0.012)

LIB = {k[4:]: v for k, v in globals().items() if k.startswith('sfx_')}
plan = [x.strip() for x in a.sfx.split(',')] if a.sfx else []
for k, entry in enumerate(plan[:len(DURS)]):
    for name in filter(None, entry.split('+')):
        if name == '-': continue
        if name not in LIB: raise SystemExit(f'unknown sfx "{name}"; choose from {sorted(LIB)}')
        LIB[name](STARTS[k], DURS[k])

# transitions: whoosh into each cut + soft low hit
for c in STARTS[1:]:
    n = int(1.0 * SR); tt = np.arange(n) / SR
    add(band(rng.standard_normal(n), 400, 5000) * (tt / 1.0) ** 3 * np.exp(-np.clip(tt - 0.85, 0, None) * 30), c - 0.85, 0.12)
    add(tone(1.2, 62, 4, 44), c, 0.35)

mix = np.stack([L, R], 1)
mix *= np.clip(t / 0.4, 0, 1)[:, None] * np.clip((TOTAL - t) / 1.5, 0, 1)[:, None]
mix = np.tanh(mix * 1.3) / np.tanh(1.3); mix /= np.max(np.abs(mix)) / 0.89
media = os.path.join(a.project, 'media'); os.makedirs(media, exist_ok=True)
wav = os.path.join(media, 'soundtrack.wav')
with wave.open(wav, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype('<i2').tobytes())
m4a = os.path.join(media, 'soundtrack.m4a')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', m4a], check=True)
print(f'wrote {m4a} ({TOTAL:.1f}s, {len(DURS)} scenes, mood={a.mood})')
for k, (s0, d) in enumerate(zip(STARTS, DURS)):
    seg = mix[int(s0 * SR):int((s0 + d) * SR)]
    print(f'  scene {k + 1}: {s0:5.1f}-{s0 + d:5.1f}s  rms {20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9):6.1f} dB')
