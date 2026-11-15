"""Original STUDIO starter one-shots; synthesis recipe and outputs dedicated to CC0."""
import math, random, wave, struct
from pathlib import Path
RATE = 44100
random.seed(42)
out = Path(__file__).resolve().parent.parent / 'public' / 'samples'
out.mkdir(parents=True, exist_ok=True)
for name, duration in [('felt-kick', .55), ('soft-clap', .35), ('dusty-shaker', .22), ('velvet-key', 2.5), ('air-texture', 3.0), ('round-bass', 1.3)]:
    values = []
    phase = 0
    for i in range(int(RATE*duration)):
        t = i/RATE
        noise = random.random()*2-1
        if name == 'felt-kick':
            phase += 2*math.pi*(48+110*math.exp(-t*35))/RATE
            v = math.sin(phase)*math.exp(-t*10)*.8 + noise*math.exp(-t*180)*.1
        elif name == 'soft-clap':
            env = sum(math.exp(-max(0,t-delay)*45) if t>=delay else 0 for delay in [0,.013,.027])
            v = noise*env*.25
        elif name == 'dusty-shaker': v = noise*math.exp(-t*35)*.3
        elif name == 'velvet-key': v = sum(math.sin(2*math.pi*f*t+1.2*math.sin(2*math.pi*f*2*t)*math.exp(-t*6))*math.exp(-t*2) for f in [261.6256,311.127,391.995,466.164])*.13*min(1,t*150)
        elif name == 'round-bass': v = (math.sin(2*math.pi*65.406*t)+.2*math.sin(2*math.pi*130.812*t))*.6*min(1,t*180)*math.exp(-t*4)
        else: v = sum(math.sin(2*math.pi*f*t) for f in [261.6256,329.628,391.995,493.883])*.1*min(1,t*3,(duration-t)*3)+noise*.007
        v *= min(1,(duration-t)*100)
        values.append(struct.pack('<h',int(max(-1,min(1,v))*32767)))
    with wave.open(str(out/(name+'.wav')),'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(b''.join(values))
