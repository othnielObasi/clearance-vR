#!/usr/bin/env python3
"""Join the filmed scenes into a captioned rough cut (a starting point for the demo video).

    python3 scripts/reel.py FILM_DIR OUT.mp4 [--font Bold.ttf] [--font-regular Regular.ttf]

FILM_DIR holds the clips from scripts/film.cjs (firstPermit.mp4, flick.mp4, ...). Needs ffmpeg.
Captions are burned in as lower thirds; a title card opens and says this is emulator footage.
"""
import argparse
import os
import subprocess
import tempfile

W, H, FPS = 1280, 720, 30
INK = '0x1f2328'
SAFETY = '0xffc93c'
CONCRETE = '0xd9d4ca'

# (clip, caption, seconds to trim from the start)
SCENES = [
    ('firstPermit', ['The first time you need a gesture, a ghost hand shows you.', 'Pinch a permit and drop it on a robot. It moves only on your permit.'], 0),
    ('flick', ['Bolt offers a shortcut through the spill.', 'Rest a finger on it and flick it away. He plans by the book.'], 0),
    ('palmStop', ['Someone is on the floor.', 'Hold up a palm and the robot brakes.'], 0),
    ('handWall', ['Your hand is a wall.', 'Lay it across the aisle and the robots plan round it.'], 0),
    ('gold', ['Good judgement earns a gold permit.', 'Trust a robot with it and it works alone for 20 seconds.'], 0),
]


def esc(t: str) -> str:
    return t.replace('\\', '\\\\').replace(':', '\\:').replace("'", "’").replace('%', '\\%')


def run(*args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


def card(path, font, regular, lines, seconds=3.0):
    """A plain card: big stencil-yellow title, smaller lines under it."""
    draws = []
    title, *rest = lines
    draws.append(f"drawtext=fontfile='{font}':text='{esc(title)}':fontcolor={SAFETY}:fontsize=120:x=(w-text_w)/2:y=h*0.36")
    for i, line in enumerate(rest):
        draws.append(f"drawtext=fontfile='{regular}':text='{esc(line)}':fontcolor={CONCRETE}:fontsize={40 if i == 0 else 26}:x=(w-text_w)/2:y=h*0.58+{i}*56")
    run('-f', 'lavfi', '-i', f'color=c={INK}:s={W}x{H}:r={FPS}:d={seconds}', '-vf', ','.join(draws),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', path)


def captioned(src, dst, font, regular, lines, trim):
    """Lower-third caption: first line from the start, second line from 45% of the clip."""
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src],
                               capture_output=True, text=True, check=True).stdout)
    split = max(1.5, (dur - trim) * 0.45)
    box = f"drawbox=x=0:y=ih-110:w=iw:h=110:color={INK}@0.78:t=fill"
    stripe = f"drawbox=x=0:y=ih-110:w=iw:h=5:color={SAFETY}@1:t=fill"
    t1 = f"drawtext=fontfile='{font}':text='{esc(lines[0])}':fontcolor=white:fontsize=40:x=48:y=h-80:enable='lt(t,{split})'"
    t2 = f"drawtext=fontfile='{font}':text='{esc(lines[1])}':fontcolor=white:fontsize=40:x=48:y=h-80:enable='gte(t,{split})'"
    run('-ss', str(trim), '-i', src, '-vf', ','.join([box, stripe, t1, t2]), '-r', str(FPS),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('film_dir')
    ap.add_argument('out')
    ap.add_argument('--font', default='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
    ap.add_argument('--font-regular', default=None)
    a = ap.parse_args()
    regular = a.font_regular or a.font
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        title = os.path.join(tmp, '00-title.mp4')
        card(title, a.font, regular, ['Clearance', 'Tiny robots plan. Nothing moves without your clearance.',
                                      'Recorded in the Meta Immersive Web Emulator (synthetic room, emulated hands)'])
        parts.append(title)
        for i, (name, lines, trim) in enumerate(SCENES, 1):
            src = os.path.join(a.film_dir, f'{name}.mp4')
            if not os.path.exists(src):
                print(f'skip {name}: no clip')
                continue
            dst = os.path.join(tmp, f'{i:02d}-{name}.mp4')
            captioned(src, dst, a.font, regular, lines, trim)
            parts.append(dst)
        end = os.path.join(tmp, '99-end.mp4')
        card(end, a.font, regular, ['Clearance', 'Hands-first mixed reality for Meta Quest',
                                    'Open it in the Meta Quest Browser. Nothing to install.'], 3.5)
        parts.append(end)
        listing = os.path.join(tmp, 'list.txt')
        with open(listing, 'w') as f:
            f.writelines(f"file '{p}'\n" for p in parts)
        run('-f', 'concat', '-safe', '0', '-i', listing, '-c', 'copy', a.out)
    print(a.out)


if __name__ == '__main__':
    main()
