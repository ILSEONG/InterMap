# 홍보영상 배경음악을 직접 만든다 (외부 음원 없이 코드로 합성 — 저작권 걱정 없는 자작곡).
# 느낌: 몽글몽글하고 산뜻하게. F장조, 100BPM. 부드러운 패드 + 일렉피아노 분산화음 + 칼림바 멜로디 + 가벼운 리듬.
#   python3 music.py <out.wav> <도입 박> <본편 박> <끝 박>     (1박 = 0.6초, 본편은 4박 단위)
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR, BPM = 48000, 100
BEAT = 60 / BPM
SCALE = {5, 7, 9, 10, 0, 2, 4}   # F장조
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
tt = lambda n: np.arange(n) / SR

# 화음: (베이스 근음, 5음, 패드 구성음)
CH = {
    'Bb': (46, 53, [58, 62, 65, 69]), 'C6': (48, 55, [55, 60, 64, 69]), 'Am': (45, 52, [57, 60, 64, 67]), 'Dm': (50, 57, [57, 60, 62, 65]),
    'Gm': (43, 50, [58, 62, 65, 67]), 'C': (48, 55, [55, 60, 64, 67]), 'F': (41, 48, [57, 60, 65, 67]),
}
LOOP = ['Bb', 'C6', 'Am', 'Dm']
# 칼림바 멜로디 — 8분음표 8칸, 0은 쉼
MEL_A = [[74, 0, 77, 0, 81, 0, 79, 77], [76, 0, 79, 0, 0, 84, 0, 0], [72, 0, 76, 0, 79, 0, 81, 79], [77, 0, 0, 74, 0, 0, 72, 0]]
MEL_B = [[0, 77, 81, 0, 86, 0, 84, 0], [79, 0, 76, 0, 79, 84, 0, 0], [81, 0, 79, 0, 76, 0, 72, 0], [74, 0, 77, 0, 81, 0, 0, 0]]
MEL_TAIL = [[74, 0, 77, 0, 79, 0, 82, 0], [81, 0, 77, 0, 74, 0, 77, 0], [76, 0, 79, 0, 84, 0, 86, 0]]
MEL_INTRO = [[0, 0, 0, 0, 81, 0, 0, 77], [79, 0, 0, 84, 0, 0, 79, 76]]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]

def fade(y, a=0.003, r=0.03):
    n = len(y); na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    y[:na] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / max(na, 1)); y[n - nr:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(nr) / max(nr, 1))
    return y

def ep(m, dur, vel):          # 일렉피아노 — 둥글고 따뜻하게
    f = hz(m); t = tt(int(dur * SR)); idx = (0.7 + 1.2 * vel) * np.exp(-t * 5.5)
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t * 2.4)
    y += 0.17 * vel * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 14)
    return fade(y * vel, 0.004, 0.06)

def kalimba(m, dur, vel):     # 칼림바 — 통통 튀는 맑은 소리
    f = hz(m); t = tt(int(dur * SR))
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * 4.2) + 0.26 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 9) + 0.08 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t * 32)
    return fade(y * vel, 0.003, 0.05)

def bell(m, dur, vel):        # 멜로디 위에 얹는 작은 종소리 — 반짝이는 느낌만 살짝
    f = hz(m); t = tt(int(dur * SR))
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * 6) + 0.35 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t * 13)
    return fade(y * vel, 0.002, 0.05)

def pad(notes, dur, cents):   # 패드 — 천천히 부풀었다 가라앉는다
    t = tt(int(dur * SR)); y = np.zeros(len(t))
    for m in notes:
        f = hz(m) * 2 ** (cents / 1200)
        y += np.sin(2 * np.pi * f * t) + 0.32 * np.sin(2 * np.pi * 2 * f * t + 0.6) + 0.10 * np.sin(2 * np.pi * 3 * f * t + 1.1)
    y *= 1 + 0.06 * np.sin(2 * np.pi * 0.35 * t + cents)
    return fade(y / len(notes), 0.55, 0.7)

def bass(m, dur, vel):
    f = hz(m); t = tt(int(dur * SR))
    y = (np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * 2 * f * t) + 0.15 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t * 2.2)
    return fade(y * vel, 0.01, 0.08)

def kick(vel):
    t = tt(int(0.32 * SR)); f = 48 + 72 * np.exp(-t * 26)
    return fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) * vel, 0.002, 0.05)

RNG = np.random.default_rng(7)
HP = signal.butter(2, 6500, 'highpass', fs=SR, output='sos'); BP = signal.butter(2, [1300, 3600], 'bandpass', fs=SR, output='sos')
def shaker(vel):
    t = tt(int(0.09 * SR)); return fade(signal.sosfilt(HP, RNG.standard_normal(len(t))) * np.exp(-t * 48) * vel, 0.004, 0.02)
def snap(vel):
    t = tt(int(0.12 * SR)); return fade(signal.sosfilt(BP, RNG.standard_normal(len(t))) * np.exp(-t * 36) * vel, 0.001, 0.03)

def glass(seed):              # 유리창이 깨지는 소리 — 깨지는 순간의 넓은 소음 + 둔탁한 충격 + 흩어져 떨어지는 조각들
    n = int(2.0 * SR); t = tt(n); y = np.zeros(n); rng = np.random.default_rng(seed)
    y += 1.0 * signal.sosfilt(signal.butter(2, [1400, 7500], 'bandpass', fs=SR, output='sos'), rng.standard_normal(n)) * np.exp(-t * 34)
    y += 0.55 * np.sin(2 * np.pi * np.cumsum(60 + 110 * np.exp(-t * 30)) / SR) * np.exp(-t * 20)
    for k in range(80):
        f = rng.uniform(1800, 8000); at = abs(rng.normal(0, 0.13)) if k < 50 else rng.uniform(0.2, 1.15)
        a = rng.uniform(0.12, 0.5) * np.exp(-at * 1.6); i = int(at * SR); tk = t[:n - i]
        y[i:] += a * np.sin(2 * np.pi * f * tk + rng.uniform(0, 6.28)) * np.exp(-tk * rng.uniform(16, 55)) * (1 - np.exp(-tk * 2500))
    return fade(y / np.abs(y).max(), 0.0005, 0.25)

def make(out, intro, body, end, shatter_at=None):
    assert body % 4 == 0 and intro % 4 == 0
    total = (intro + body + end) * BEAT; N = int((total + 3) * SR)
    dry = np.zeros((N, 2)); send = np.zeros((N, 2))
    def put(y, at, pan=0.0, gain=1.0, rev=0.0):
        i = max(0, int(round(at * SR))); y = y[:max(0, N - i)]; l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        dry[i:i + len(y), 0] += y * l * gain; dry[i:i + len(y), 1] += y * r * gain
        if rev: send[i:i + len(y), 0] += y * l * gain * rev; send[i:i + len(y), 1] += y * r * gain * rev
    def melody(bar_at, row, gain):
        for k, m in enumerate(row):
            if m:
                assert m % 12 in SCALE; v = 0.85 + 0.15 * (k % 4 == 0)
                put(kalimba(m, 1.3, v), bar_at + k * BEAT / 2, 0.18, gain, 0.55); put(bell(m + 12, 0.9, v), bar_at + k * BEAT / 2, -0.2, gain * 0.22, 0.7)
    def pad_bar(name, at, beats, gain):
        d = beats * BEAT + 0.5
        put(pad(CH[name][2], d, -4), at - 0.05, -0.7, gain, 0.35); put(pad(CH[name][2], d, 4), at - 0.05, 0.7, gain, 0.35)

    # 도입 — 패드와 드문드문한 칼림바만
    for b in range(intro // 4):
        at = b * 4 * BEAT; name = LOOP[b % 2]; pad_bar(name, at, 4, 0.17)
        for j, m in enumerate(CH[name][2]): put(ep(m + 12, 2.2, 0.5), at + j * 0.045, -0.25 + 0.17 * j, 0.20, 0.5)
        melody(at, MEL_INTRO[b % 2], 0.30)
    # 본편 — 분산화음·베이스·가벼운 리듬이 들어온다
    bars = body // 4; t0 = intro * BEAT
    chords = [LOOP[i % 4] for i in range(bars - 3)] + ['Gm', 'Bb', 'C']
    rows = [(MEL_A + MEL_B)[i % 8] for i in range(bars - 3)] + MEL_TAIL
    for b, name in enumerate(chords):
        at = t0 + b * 4 * BEAT; root, fifth, notes = CH[name]; last = b == bars - 1
        pad_bar(name, at, 4, 0.15)
        for k in range(8):
            m = notes[ARP[k]] + 12; assert m % 12 in SCALE
            put(ep(m, 0.9, 0.62 + 0.2 * (k % 2 == 0)), at + k * BEAT / 2, -0.35 if k % 2 == 0 else 0.3, 0.27, 0.4)
        put(bass(root, 1.6 * BEAT, 1.0), at, 0, 0.34); put(bass(root, 0.9 * BEAT, 0.8), at + 1.5 * BEAT, 0, 0.30); put(bass(fifth, 0.9 * BEAT, 0.8), at + 3 * BEAT, 0, 0.28)
        put(kick(1.0), at, 0, 0.36); put(kick(0.8), at + 2 * BEAT, 0, 0.30)
        for k in range(8): put(shaker(0.6 if k % 2 == 0 else 1.0), at + k * BEAT / 2, 0.4 if k % 2 else -0.4, 0.10, 0.2)
        if b >= 2 and not last:
            put(snap(1.0), at + BEAT, 0.1, 0.085, 0.5); put(snap(1.0), at + 3 * BEAT, -0.1, 0.085, 0.5)
        melody(at, rows[b], 0.36)
    # 끝 — 으뜸화음으로 내려앉아 울림만 남긴다
    at = t0 + body * BEAT; pad_bar('F', at, end + 2, 0.17); put(kick(0.9), at, 0, 0.32); put(bass(41, 2.5, 1.0), at, 0, 0.36)
    for j, m in enumerate(CH['F'][2]): put(ep(m + 12, 3.0, 0.7), at + j * 0.05, -0.3 + 0.2 * j, 0.26, 0.6)
    for j, m in enumerate([77, 81, 84, 89]): put(kalimba(m, 2.2, 0.9), at + j * BEAT / 4, 0.15, 0.36, 0.7); put(bell(m + 12, 1.6, 0.9), at + j * BEAT / 4, -0.2, 0.08, 0.8)

    # 울림(리버브)
    n = int(1.7 * SR); t = tt(n); lp = signal.butter(2, 5200, 'lowpass', fs=SR, output='sos'); wet = np.zeros_like(dry)
    for c in range(2):
        ir = signal.sosfilt(lp, RNG.standard_normal(n)) * np.exp(-t * 3.4); ir[:int(0.012 * SR)] = 0; ir /= np.sqrt((ir ** 2).sum())
        wet[:, c] = signal.fftconvolve(send[:, c], ir)[:N]
    mix = dry + 0.5 * wet
    if shatter_at is not None:
        # 깨지는 소리가 묻히지 않게 그 순간 음악을 낮췄다가 서서히 되돌린다
        i = int(shatter_at * SR); env = np.ones(N); hold, back = int(0.6 * SR), int(1.4 * SR)
        env[i:i + hold] = 0.22; env[i + hold:i + hold + back] = 0.22 + 0.78 * (0.5 - 0.5 * np.cos(np.pi * np.arange(back) / back))[:max(0, N - i - hold)][:len(env[i + hold:i + hold + back])]
        k = int(0.01 * SR); env[i - k:i] = np.linspace(1, 0.22, k)
        mix *= env[:, None]
        for c, seed in enumerate((11, 23)):
            g = glass(seed)[:N - i]; mix[i:i + len(g), c] += 0.95 * g; mix[i:i + len(g), 1 - c] += 0.45 * g
    mix = signal.sosfilt(signal.butter(2, 38, 'highpass', fs=SR, output='sos'), mix, axis=0)
    air = signal.sosfilt(signal.butter(1, 3200, 'highpass', fs=SR, output='sos'), mix, axis=0); mix = mix + 0.55 * air
    mix = mix[:int(total * SR)]
    k = int(1.3 * SR); mix[-k:] *= (0.5 + 0.5 * np.cos(np.pi * np.arange(k) / k))[:, None]; mix[:int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))[:, None]
    mix = np.tanh(mix * 1.15) / np.tanh(1.15); mix *= 0.7 / np.abs(mix).max()
    wavfile.write(out, SR, (mix * 32767).astype(np.int16))
    return total

if __name__ == '__main__':
    print(f'{make(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])):.2f}s')
