import {decodeSample, temperature, memory, COLORS, GIB} from '../model.js';
let assertions = 0;
function equal(actual, expected, message) {
    assertions++;
    if (actual !== expected) throw new Error(`${message}: got ${actual}, expected ${expected}`);
}
for (const bad of [null, undefined, NaN, Infinity, -1, '50', 151])
    equal(temperature(bad, 'cpu').text, '—', 'Invalid temperature must never appear as zero');
equal(temperature(0, 'cpu').text, '0°', 'Zero is a valid sensor value');
equal(temperature(64, 'cpu').color, COLORS.cool, 'CPU below threshold');
equal(temperature(65, 'cpu').color, COLORS.warm, 'CPU warm threshold');
equal(temperature(80, 'cpu').color, COLORS.hot, 'CPU hot threshold');
equal(temperature(90, 'cpu').color, COLORS.critical, 'CPU critical threshold');
equal(temperature(55, 'gpu').color, COLORS.warm, 'GPU has its own thresholds');
equal(temperature(83, 'gpu').color, COLORS.critical, 'GPU critical threshold');
equal(memory(0, 12 * GIB, 'vram').text, '0.0G', 'Empty memory');
equal(memory(1.5 * GIB, 12 * GIB, 'vram').text, '1.5G', 'Binary units');
equal(memory(8 * GIB, 32 * GIB, 'ram', true).text, '25%', 'Percent view');
equal(memory(8, 4, 'ram').text, '—', 'Invalid accounting');
equal(memory(0, 0, 'ram').text, '—', 'Zero capacity');
equal(memory(93, 100, 'vram').color, COLORS.critical, 'Near full memory');
const parsed = decodeSample(JSON.stringify({version: 1, cpuTemp: null, gpuTemp: 45, ramUsed: 99, ramTotal: 100,
    vramUsed: -1, vramTotal: 120, cpuSource: 'k10temp', gpuName: 'RTX'}));
equal(parsed.cpuTemp, null, 'Missing sensor preserved');
equal(parsed.gpuTemp, 45, 'Valid temperature preserved');
equal(parsed.vramUsed, null, 'Invalid memory rejected');
equal(parsed.vramTotal, null, 'Invalid pair cleared');
for (const line of ['garbage', '{}', 'x'.repeat(5000)]) {
    let rejected = false;
    try { decodeSample(line); } catch { rejected = true; }
    equal(rejected, true, 'Malformed protocol is rejected');
}
print(`PASS: ${assertions} sensor formatting and failure assertions`);
