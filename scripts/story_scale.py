import re
from pathlib import Path


def scale_timeline(main_file: Path, target: int):
    src = main_file.read_text(encoding='utf-8')
    timeline = re.search(r'export\s+(?:const|let)\s+TIMELINE\s*=\s*\[', src)
    if not timeline:
        raise RuntimeError('Could not locate the original scene timeline')
    start = timeline.start()
    end = src.index('\n];', start) + 3
    block = src[start:end]
    durs = [float(x) for x in re.findall(r'\bdur:\s*([\d.]+)', block)]
    if not durs:
        raise RuntimeError('Could not parse the original scene timeline')
    factor = target / sum(durs)
    block = re.sub(r'(\bdur:\s*)([\d.]+)', lambda m: m.group(1) + f'{float(m.group(2))*factor:.4f}', block)
    # Scale caption start/end values within each scene; population ranges remain unchanged.
    block = re.sub(r"\[(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(['\"])",
                   lambda m: f'[{float(m.group(1))*factor:.4f}, {float(m.group(2))*factor:.4f}, {m.group(3)}', block)
    main_file.write_text(src[:start] + block + src[end:], encoding='utf-8')
