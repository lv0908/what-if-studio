"""Build a ready-to-extract delivery folder + ZIP for a page/episode.

    python3 package_folder.py --out <dir> --name "FACEBOOK AUTOMATION" \
        --add "01 Videos/Episode 01 - Title.mp4=path/to/final.mp4" \
        --add "02 Branding/Profile Picture 1080x1080.png=path/to/profile.png" \
        --text "04 Captions and Hashtags/Episode 01.txt=path/to/caption.txt" \
        [--tree "05 Source Files=path/to/project"]

--add copies a file, --text copies a text file and converts it to Windows line endings (so it
opens cleanly in Notepad), --tree copies a directory (skipping media/chunks, media/stills and
node_modules). Writes <out>/<name>/ and <out>/<name>.zip (the ZIP's top folder is <name>, so
extracting it to D:\\ gives D:\\<name>\\...).
"""
import argparse, os, shutil, zipfile

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--name', required=True)
ap.add_argument('--add', action='append', default=[])
ap.add_argument('--text', action='append', default=[])
ap.add_argument('--tree', action='append', default=[])
a = ap.parse_args()

root = os.path.join(a.out, a.name)
shutil.rmtree(root, ignore_errors=True)
def dest(rel):
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True); return p
for spec in a.add:
    rel, src = spec.split('=', 1); shutil.copy2(src, dest(rel))
for spec in a.text:
    rel, src = spec.split('=', 1)
    s = open(src, encoding='utf-8').read().replace('\r\n', '\n').replace('\n', '\r\n')
    open(dest(rel), 'w', encoding='utf-8', newline='').write(s)
skip = {'chunks', 'stills', 'node_modules', '.git'}
for spec in a.tree:
    rel, src = spec.split('=', 1)
    shutil.copytree(src, os.path.join(root, rel), ignore=lambda d, names: [n for n in names if n in skip or n.endswith(('.wav', '.log'))])

zpath = os.path.join(a.out, a.name + '.zip')
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(root):
        for f in sorted(files):
            p = os.path.join(d, f); z.write(p, os.path.relpath(p, a.out))
n = sum(len(f) for _, _, f in os.walk(root))
print(f'wrote {zpath} ({n} files, {os.path.getsize(zpath) / 1048576:.1f} MB)')
