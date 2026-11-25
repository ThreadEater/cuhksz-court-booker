"""Build one Chrome/Edge package with an explicit allowlist, using stdlib only."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'extension/manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
files = ['README.md', 'CHANGELOG.md', 'LICENSE', 'docs/使用指南.md', 'docs/隐私与反馈.md']
files += ['extension/' + name for name in ['manifest.json', 'model.js', 'worker.js', 'content.js', 'site.js', 'popup.js', 'popup.html', 'popup.css']]
files += [f'extension/icons/{size}.png' for size in [16, 32, 48, 128]]
files += ['docs/images/chrome-extensions.png', 'docs/images/edge-extensions.png']
pdf = ROOT / 'docs/Court-Guide.pdf'
if pdf.exists():
    files.append('docs/Court-Guide.pdf')
dest = ROOT / 'dist'
dest.mkdir(exist_ok=True)
output = dest / f'Court-{version}.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        source = ROOT / name
        if not source.is_file() or source.is_symlink():
            raise ValueError(f'Missing or unsafe release file: {name}')
        archive.write(source, f'Court-{version}/{name}')
digest = hashlib.sha256(output.read_bytes()).hexdigest()
(dest / 'SHA256SUMS.txt').write_text(f'{digest}  {output.name}\n', encoding='utf-8')
print(f'{output.name}: {output.stat().st_size} bytes, SHA256 {digest}')
