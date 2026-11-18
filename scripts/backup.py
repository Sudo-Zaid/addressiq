# -*- coding: utf-8 -*-
"""Safety copy of the whole project into  <parent folder>/addressiq-backups/<date_time>/

    python scripts/backup.py        (or double-click backup.bat)

What goes in:
  addressiq.bundle    every branch with its full history, as one file (git clone addressiq.bundle restores it)
  code-master.zip     the files of the master branch, for a quick look or a manual copy
  data/               the app database (orders, users, zones, learned addresses) and the map data
  secrets/            tunnel credentials, server key, Cloudflare certificate - never share or commit this folder
"""
import os, shutil, sqlite3, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DEST = os.path.join(os.path.dirname(ROOT), 'addressiq-backups', time.strftime('%Y-%m-%d_%H%M'))

def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True)

def copy(src, sub):
    if not os.path.isfile(src): return False
    os.makedirs(os.path.join(DEST, sub), exist_ok=True)
    shutil.copy2(src, os.path.join(DEST, sub, os.path.basename(src)))
    return True

def main():
    os.makedirs(DEST, exist_ok=True)
    git('fetch', '--quiet', 'origin')                                   # include what the others have pushed
    r = git('bundle', 'create', os.path.join(DEST, 'addressiq.bundle'), '--branches', '--remotes=origin')
    if r.returncode: print('git bundle failed:', r.stderr.strip())
    git('archive', '--format=zip', '-o', os.path.join(DEST, 'code-master.zip'), 'master')

    db = os.path.join(ROOT, 'data', 'app.sqlite')
    if os.path.isfile(db):                                              # a consistent copy even while the API is running
        os.makedirs(os.path.join(DEST, 'data'), exist_ok=True)
        src = sqlite3.connect(db); dst = sqlite3.connect(os.path.join(DEST, 'data', 'app.sqlite'))
        with dst: src.backup(dst)
        counts = {t: dst.execute('SELECT COUNT(*) FROM %s' % t).fetchone()[0] for t in ('organizations', 'users', 'zones', 'orders', 'observations')}
        src.close(); dst.close()
        print('database copied:', counts)
    for f in ('gazetteer.sqlite', 'osm_raw.json', 'sample_orders.csv'):
        copy(os.path.join(ROOT, 'data', f), 'data')
    secrets = [os.path.join(ROOT, 'tools', f) for f in ('addressiq-tunnel.json', 'azure_vm_key', 'azure_vm_key.pub')]
    secrets.append(os.path.join(os.path.expanduser('~'), '.cloudflared', 'cert.pem'))
    kept = [os.path.basename(s) for s in secrets if copy(s, 'secrets')]

    head = git('log', '-1', '--format=%h %s', 'master').stdout.strip()
    with open(os.path.join(DEST, 'RESTORE.txt'), 'w', encoding='utf-8') as f:
        f.write('AddressIQ backup made %s\nmaster was at: %s\n\n' % (time.strftime('%Y-%m-%d %H:%M'), head))
        f.write('Get the code back (all branches, full history):\n    git clone addressiq.bundle addressiq\n'
                '    cd addressiq && git remote set-url origin https://github.com/Sudo-Zaid/addressiq.git\n\n'
                'Put one branch back on GitHub exactly as it is in this backup (overwrites that branch there):\n'
                '    git push --force origin master\n\n'
                'Data: copy data/app.sqlite (stop the API first), data/gazetteer.sqlite and data/osm_raw.json into the project\'s data folder.\n'
                'Secrets: copy secrets/addressiq-tunnel.json and secrets/azure_vm_key* into the project\'s tools folder,\n'
                '         and secrets/cert.pem into %USERPROFILE%\\.cloudflared\\ . Never commit or share the secrets folder.\n')
    size = sum(os.path.getsize(os.path.join(d, x)) for d, _, fs in os.walk(DEST) for x in fs)
    print('secrets copied:', kept or 'none found')
    print('backup folder: %s  (%.1f MB)' % (DEST, size / 1048576))

if __name__ == '__main__':
    sys.exit(main())
