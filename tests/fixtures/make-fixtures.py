"""Gera imagens de teste (não usadas pelo app em produção):
- pintura.jpg: "pintura" sintética com pinceladas (paisagem com lago e ponte), original.
- foto-parede.jpg: a mesma pintura fotografada na parede, com perspectiva, mesa e ruído.
Uso: python3 tests/fixtures/make-fixtures.py
"""
import random, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)
OUT = Path(__file__).parent
W, H = 900, 1200

img = Image.new('RGB', (W, H), (40, 70, 60))
d = ImageDraw.Draw(img, 'RGBA')
greens = [(58, 110, 70), (90, 140, 60), (150, 170, 70), (40, 90, 90), (70, 120, 140), (110, 100, 170), (190, 200, 110), (30, 60, 50)]
pinks = [(210, 150, 190), (230, 190, 210), (180, 120, 170)]
# Pinceladas curtas em várias direções (textura rica para rastreamento).
for _ in range(9000):
    x, y = random.uniform(0, W), random.uniform(0, H)
    band = y / H
    c = random.choice(greens[:5] if band > 0.55 else greens[3:])
    a = random.uniform(-0.6, 0.6) + (0 if band > 0.4 else math.pi / 2 * random.choice([0, 1]))
    L = random.uniform(8, 26)
    wdt = random.randint(3, 7)
    d.line([(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)], fill=c + (220,), width=wdt)
# Nenúfares.
for _ in range(260):
    x, y = random.uniform(0, W), random.uniform(80, H * 0.62)
    r = random.uniform(4, 11)
    d.ellipse([x - r * 1.6, y - r, x + r * 1.6, y + r], fill=random.choice(pinks) + (230,))
# Ponte.
by = H * 0.52
for k in range(3):
    d.arc([-200, by - 120 + k * 10, W + 200, by + 260 + k * 10], 190, 350, fill=(70, 120, 150), width=10)
for x in range(30, W, 140):
    d.line([(x, by + 30), (x + 10, by + 170)], fill=(200, 215, 200), width=9)
d.line([(0, by + 60), (W, by + 40)], fill=(190, 210, 190), width=8)
d.line([(0, by + 110), (W, by + 95)], fill=(190, 210, 190), width=7)
img = img.filter(ImageFilter.SMOOTH_MORE)
img.save(OUT / 'pintura.jpg', quality=92)

# "Foto" na parede: fundo claro, mesa de madeira, pintura em perspectiva.
PW, PH = 1200, 1600
photo = Image.new('RGB', (PW, PH), (232, 229, 222))
pd = ImageDraw.Draw(photo)
pd.rectangle([0, int(PH * 0.66), PW, PH], fill=(120, 72, 40))
for i in range(60):
    y = int(PH * 0.66) + i * 9
    pd.line([(0, y), (PW, y + random.randint(-6, 6))], fill=(105 + random.randint(-12, 12), 62, 35), width=3)
quad = [(250, 330), (930, 360), (905, 1290), (235, 1270)]  # TL, TR, BR, BL
coeffs_src = [(0, 0), (W, 0), (W, H), (0, H)]
def perspective_coeffs(dst, src):
    import numpy as np
    A = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    b = [c for p in src for c in p]
    return list(np.linalg.solve(np.array(A, float), np.array(b, float)))
warped = img.transform((PW, PH), Image.PERSPECTIVE, perspective_coeffs(quad, coeffs_src), Image.BICUBIC)
mask = Image.new('L', (PW, PH), 0)
ImageDraw.Draw(mask).polygon(quad, fill=255)
photo.paste(warped, (0, 0), mask)
photo = photo.filter(ImageFilter.GaussianBlur(0.8))
photo.save(OUT / 'foto-parede.jpg', quality=88)
print('ok', OUT)
