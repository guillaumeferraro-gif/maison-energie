"""Build the portable HTML and the installation kit from the same verified source."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
html = (DIST / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + (DIST / 'style.css').read_text() + '</style>')
for name in ('energy-core.js', 'access.js', 'app.js'):
    script = (DIST / name).read_text().replace('</script', '<\\/script')
    html = html.replace(f'<script src="{name}"></script>', '<script>' + script + '\n</script>')
(DIST / 'maison-energie.html').write_text(html)
files = ['dist/index.html', 'dist/style.css', 'dist/energy-core.js', 'dist/access.js', 'dist/app.js', 'dist/maison-energie.html',
         'integration/collecteur-shelly.js', 'integration/portail-shelly.js', 'integration/Google-Apps-Script.gs', 'integration/appsscript.json',
         'demarrer.py', 'preparer.py', 'LIRE-MOI.md', 'tests/energy.test.cjs', 'tests/access.test.cjs']
with ZipFile(DIST / 'installation.zip', 'w', ZIP_DEFLATED) as z:
    for name in files:
        z.write(ROOT / name, 'maison-energie/' + name)
print('HTML autonome et kit prêts.')
