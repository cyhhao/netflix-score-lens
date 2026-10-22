#!/usr/bin/env python3
"""Build a credential-free publisher handoff, never upload/submit or imply approval."""
from pathlib import Path
import contextlib
import datetime
import hashlib
import io
import json
import runpy
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / 'store'
# Reuse the canonical allowlist, not a recursive working-directory archive.
with contextlib.redirect_stdout(io.StringIO()):
    packaged = runpy.run_path(str(ROOT / 'scripts/package.py'))
version, runtime = packaged['version'], packaged['files']
readiness = json.loads((STORE / 'readiness.json').read_text())
if readiness['candidateVersion'] != version:
    raise SystemExit('Update/review store readiness for this candidate version')
if readiness['status'] != 'preparation-only' or readiness['submissionAllowed'] is not False or readiness['uploadedToStore'] is not False:
    raise SystemExit('This builder produces preparation-only kits, not approved submissions')
if not readiness['gates'] or not all(x['status'] in {'open', 'owner-action'} for x in readiness['gates']):
    raise SystemExit('Unexpected readiness state; review gates explicitly')

candidate = ROOT / 'dist' / f'netflix-score-lens-{version}-chrome-web-store.zip'
with zipfile.ZipFile(candidate) as z:
    if z.testzip() is not None or set(z.namelist()) != set(runtime):
        raise SystemExit('Runtime ZIP membership/CRC mismatch')
    for name in runtime:
        if z.read(name) != (ROOT / name).read_bytes():
            raise SystemExit(f'Package differs from source: {name}')

manifest = json.loads((ROOT / 'manifest.json').read_text())
if manifest.get('default_locale') != 'en':
    raise SystemExit('Expected native default locale en')
fields = {k: readiness[k] for k in ('homepage', 'support', 'privacyPolicy')}
fields['locales'] = {}
for locale, chrome_locale in [('en', 'en'), ('zh-CN', 'zh_CN')]:
    messages = json.loads((ROOT / '_locales' / chrome_locale / 'messages.json').read_text())
    name, summary = (messages[k]['message'] for k in ('extensionName', 'extensionDescription'))
    if name != readiness['listingName'] or not 1 <= len(name) <= 45 or not 20 <= len(summary) <= 132:
        raise SystemExit(f'Invalid listing name/summary: {locale}')
    description = (STORE / f'listing.{locale}.txt').read_text()
    if not 200 <= len(description) <= 16000:
        raise SystemExit(f'Invalid full-description length: {locale}')
    fields['locales'][locale] = {'name': name, 'summary': summary, 'descriptionFile': f'listing.{locale}.txt'}


def png_info(path, size, allow_alpha=False):
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise SystemExit(f'Not a PNG: {path.name}')
    width, height, depth, color = struct.unpack('>IIBB', data[16:26])
    if (width, height) != size or depth != 8 or color not in ({2, 6} if allow_alpha else {2}):
        raise SystemExit(f'Wrong dimensions/depth/color type: {path.name}: {(width,height,depth,color)}')
    return {'width': width, 'height': height, 'bitDepth': depth, 'colorType': color,
            'sha256': hashlib.sha256(data).hexdigest()}


images = {'assets/icon-128.png': png_info(STORE / 'assets/icon-128.png', (128, 128), True),
          'assets/promo-440x280.png': png_info(STORE / 'assets/promo-440x280.png', (440, 280))}
if (STORE / 'assets/icon-128.png').read_bytes() != (ROOT / 'icons/icon128.png').read_bytes():
    raise SystemExit('Store/runtime icon mismatch')
for locale in readiness['locales']:
    for stem in ['01-ratings', '02-preview', '03-library', '04-details']:
        name = f'assets/{locale}/{stem}-1280x800.png'
        images[name] = png_info(STORE / name, (1280, 800))
asset_report = json.loads((ROOT / 'artifacts/store-assets-report.json').read_text())
if asset_report['version'] != version or asset_report['ownerProfileUsed'] is not False:
    raise SystemExit('Stale/unsafe asset report')
if {x['locale'] for x in asset_report['locales']} != set(readiness['locales']):
    raise SystemExit('Missing locale asset report')
for item in asset_report['locales']:
    if item['screenshots'] != 4 or any(item[k] != 0 for k in ['providerRequests', 'unexpectedRequests', 'pageErrors']):
        raise SystemExit('Asset generation did not complete cleanly')

# Explicit document allowlist: never include artifacts/logs, reviewer credentials,
# local configuration, browser evidence, dependencies or source checkout wholesale.
files = {}
for name in ['START-HERE.zh-CN.md', 'README.md', 'listing.en.txt', 'listing.zh-CN.txt',
             'privacy-answers.md', 'reviewer-instructions.md', 'readiness.json']:
    files[name] = (STORE / name).read_bytes()
for name in images:
    files[name] = (STORE / name).read_bytes()
files['upload/' + candidate.name] = candidate.read_bytes()
for path, name in [('docs/privacy.html', 'privacy.html'), ('docs/chrome-web-store.md', 'chrome-web-store.md'),
                   ('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md')]:
    files['reference/' + name] = (ROOT / path).read_bytes()
files['listing-fields.json'] = (json.dumps(fields, ensure_ascii=False, indent=2) + '\n').encode()
verification = {
    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'sourceHasTrackedChanges': bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT, text=True).strip()),
    'candidateVersion': version,
    'candidateSHA256': hashlib.sha256(candidate.read_bytes()).hexdigest(),
    'runtimeFiles': len(runtime), 'manifestAtRoot': True, 'nativeLocales': ['en', 'zh_CN'],
    'images': images, 'assetGeneration': asset_report,
    'submissionAllowed': False, 'dashboardActions': [],
    'scope': 'Package/image/metadata structure and offline render evidence only. Not a policy certification, live Netflix acceptance or test-suite completion claim.'
}
files['verification.json'] = (json.dumps(verification, ensure_ascii=False, indent=2) + '\n').encode()
files['SHA256SUMS.txt'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(files.items())).encode()
kit = ROOT / 'dist' / f'netflix-score-lens-{version}-store-preparation.zip'
with zipfile.ZipFile(kit, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data in sorted(files.items()):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, data)
with zipfile.ZipFile(kit) as z:
    assert z.testzip() is None and set(z.namelist()) == set(files)
print(json.dumps({'file': str(kit), 'sha256': hashlib.sha256(kit.read_bytes()).hexdigest(),
                  'bytes': kit.stat().st_size, 'files': len(files), 'runtimeFiles': len(runtime),
                  'localizedScreenshots': 8, 'sharedPromo': 1, 'submissionAllowed': False}, indent=2))
