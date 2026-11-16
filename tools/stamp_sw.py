# Met à jour la liste des fichiers et la version du service worker (sw.js).
# À lancer depuis le dossier de l'appli après chaque modification :  python3 tools/stamp_sw.py .
import hashlib, json, os, re, sys
root = sys.argv[1]
files = ['./', 'index.html', 'manifest.webmanifest']
for d in ['css', 'js', 'vendor', 'vendor/fonts', 'icons']:
    for f in sorted(os.listdir(os.path.join(root, d))):
        p = os.path.join(d, f)
        if os.path.isfile(os.path.join(root, p)) and not f.startswith('LICENSE') and not f.endswith('.txt'):
            if f == 'supabase.js':  # chargé seulement si le partage est configuré, mis en cache quand même
                pass
            files.append(p)
h = hashlib.sha256()
for f in files[1:]:
    with open(os.path.join(root, f), 'rb') as fh: h.update(fh.read())
version = h.hexdigest()[:10]
src = open(os.path.join(root, 'sw.js')).read()
src = re.sub(r"const VERSION = 'lacets-v[^']*';", f"const VERSION = 'lacets-v{version}';", src)
src = re.sub(r"const SHELL = .*?;\n", "const SHELL = " + json.dumps(files, indent=2).replace('\n', '\n') + ";\n", src, count=1, flags=re.S)
open(os.path.join(root, 'sw.js'), 'w').write(src)
print(version, len(files), 'fichiers')
