"""Install the three exact official npm packages for this probe when npm is absent.

Normal development can use npm install instead. No global installation or auth changes.
"""
from pathlib import Path
import base64
import hashlib
import io
import json
import os
import platform
import tarfile
import urllib.request

VERSION = '0.163.0'
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This fallback installer is for the current macOS arm64 host. Use npm install on other platforms.')

packages = [
    ('@openai/codex-sdk', VERSION, '@openai/codex-sdk'),
    ('@openai/codex', VERSION, '@openai/codex'),
    ('@openai/codex', VERSION + '-darwin-arm64', '@openai/codex-darwin-arm64'),
]
for name, version, destination in packages:
    with urllib.request.urlopen('https://registry.npmjs.org/' + name + '/' + version, timeout=30) as r:
        meta = json.load(r)
    with urllib.request.urlopen(meta['dist']['tarball'], timeout=90) as r:
        data = r.read()
    algorithm, expected = meta['dist']['integrity'].split('-', 1)
    actual = base64.b64encode(hashlib.new(algorithm, data).digest()).decode()
    if actual != expected:
        raise RuntimeError('Integrity verification failed')
    root = Path('node_modules') / destination
    root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
        for member in tf.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] != 'package' or '..' in parts or member.issym() or member.islnk():
                raise RuntimeError('Unsafe package member')
            if len(parts) == 1:
                continue
            path = root / Path(*parts[1:])
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(tf.extractfile(member).read())
                os.chmod(path, member.mode & 0o777)
    print(destination + '@' + version + ' verified and installed', flush=True)
