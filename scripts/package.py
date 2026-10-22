#!/usr/bin/env python3
"""Build deterministic runtime-only ZIPs; never package the working directory."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'manifest.json').read_text())
version = manifest['version']
files = [
    'manifest.json', 'background.js', 'core.js', 'providers.js', 'matching.js', 'netflix-titles.js', 'bridge.js',
    'content.js', 'content.css', 'i18n.js', 'i18n-content.js', 'i18n-library.js', 'i18n-popup.js', 'popup.html', 'popup.css', 'popup.js',
    'library.html', 'library.css', 'library.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    '_locales/en/messages.json', '_locales/zh_CN/messages.json',
] + [f'icons/icon{s}.png' for s in (16, 32, 48, 128)]
if manifest['manifest_version'] != 3:
    raise SystemExit('Expected Manifest V3')
if manifest['permissions'] != ['storage', 'activeTab']:
    raise SystemExit('Changed permissions require explicit packaging review')
for name in files:
    if not (ROOT / name).is_file():
        raise SystemExit(f'Missing runtime file: {name}')
out = ROOT / 'dist'
out.mkdir(exist_ok=True)
results = []
for kind, prefix in [('chrome-web-store', ''), ('unpacked', 'netflix-score-lens/')]:
    target = out / f'netflix-score-lens-{version}-{kind}.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in sorted(files):
            info = zipfile.ZipInfo(prefix + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, (ROOT / name).read_bytes())
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        assert prefix + 'manifest.json' in z.namelist()
        assert set(z.namelist()) == {prefix + f for f in files}
    results.append({'file': target.name, 'bytes': target.stat().st_size,
                    'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(out / 'SHA256SUMS.txt').write_text(''.join(f"{r['sha256']}  {r['file']}\n" for r in results))
print(json.dumps({'version': version, 'files_per_package': len(files), 'packages': results}, indent=2))
