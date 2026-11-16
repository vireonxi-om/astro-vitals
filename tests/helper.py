#!/usr/bin/env python3
"""Live hardware integration and child-process lifecycle checks."""
import json
import pathlib
import select
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
exe = str(ROOT / 'astro-sensors')

def read(process):
    assert select.select([process.stdout], [], [], 8)[0], 'helper timed out'
    data = json.loads(process.stdout.readline())
    assert data['version'] == 1
    for key in ['cpuTemp', 'gpuTemp']:
        assert data[key] is None or 0 <= data[key] <= 150
    for kind in ['ram', 'vram']:
        used, total = data[kind + 'Used'], data[kind + 'Total']
        assert (used is None and total is None) or 0 <= used <= total
    return data

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    assert not select.select([p.stdout], [], [], 0.2)[0], 'helper must sleep until requested'
    for _ in range(12):
        p.stdin.write('sample\n'); p.stdin.flush()
        sample = read(p)
    assert sample['ramTotal'] > 0, 'RAM unavailable on this Linux host'
    mem = {}
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        key, val = line.split(':', 1)
        mem[key] = int(val.strip().split()[0]) * 1024
    assert sample['ramTotal'] == mem['MemTotal']
    assert abs(sample['ramUsed'] - (mem['MemTotal'] - mem['MemAvailable'])) < 512 * 1024 ** 2
    p.stdin.close()
    assert p.wait(timeout=3) == 0, 'must exit when its owner closes the pipe'
finally:
    if p.poll() is None: p.kill(); p.wait()
once = subprocess.run([exe, '--once'], capture_output=True, text=True, timeout=8, check=True)
assert json.loads(once.stdout)['version'] == 1
bad = subprocess.run([exe, '--bad'], capture_output=True, timeout=8)
assert bad.returncode == 2
print('PASS: live hardware, repeated requests, idle sleep, EOF cleanup, one-shot and bad arguments')
print(json.dumps(sample, indent=2))
