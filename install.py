#!/usr/bin/env python3
"""Build and install Astro Vitals for the current user, preserving other extensions."""
from pathlib import Path
from datetime import datetime
import os
import shutil
import subprocess
import tempfile
from gi.repository import Gio

ROOT = Path(__file__).resolve().parent
UUID = 'astro-vitals@local'
subprocess.run(['make', '-C', str(ROOT)], check=True)
data = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share')))
base = data / 'gnome-shell/extensions'
base.mkdir(parents=True, exist_ok=True)
target = base / UUID
settings = Gio.Settings.new('org.gnome.shell')
enabled = settings.get_strv('enabled-extensions')
disabled = settings.get_strv('disabled-extensions')

state = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'astro-vitals'
state.mkdir(parents=True, exist_ok=True)
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
(state / f'settings-{stamp}.txt').write_text(repr({'enabled': enabled, 'disabled': disabled}) + '\n')

with tempfile.TemporaryDirectory(prefix='.astro-stage-', dir=base) as temp:
    stage = Path(temp) / UUID
    stage.mkdir()
    for name in ['extension.js', 'transport.js', 'model.js', 'stylesheet.css', 'metadata.json', 'astro-sensors']:
        shutil.copy2(ROOT / name, stage / name)
    shutil.copytree(ROOT / 'schemas', stage / 'schemas')
    backup = None
    if target.exists():
        backup = state / f'backup-{stamp}'
        target.rename(backup)
    try:
        stage.rename(target)
    except BaseException:
        if backup is not None:
            backup.rename(target)
        raise

if UUID not in enabled:
    settings.set_strv('enabled-extensions', enabled + [UUID])
if UUID in disabled:
    settings.set_strv('disabled-extensions', [item for item in disabled if item != UUID])
Gio.Settings.sync()
print(f'Installed locally: {target}')
print('Enabled for your next GNOME session. Log out and back in once to load the new extension.')
print('No desktop restart or logout was performed.')
