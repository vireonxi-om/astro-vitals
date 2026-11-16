// Pure formatting and validation, shared with the sensor transport and tests.
export const COLORS = {
    cool: '#a4dbc3', warm: '#ead49c', hot: '#efb18a', critical: '#f5939d',
    ram: '#d8e2f2', vram: '#d8e2f2', unavailable: '#8b919e',
};
export const GIB = 1024 ** 3;
export function validNumber(value, max = Number.MAX_SAFE_INTEGER) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
export function decodeSample(line) {
    if (line.length > 4096) throw new Error('Sensor response too large');
    const s = JSON.parse(line);
    if (s?.version !== 1) throw new Error('Unsupported sensor protocol');
    for (const field of ['cpuTemp', 'gpuTemp'])
        if (!validNumber(s[field], 150)) s[field] = null;
    for (const prefix of ['ram', 'vram']) {
        const used = s[`${prefix}Used`], total = s[`${prefix}Total`];
        if (!validNumber(used) || !validNumber(total) || total === 0 || used > total)
            s[`${prefix}Used`] = s[`${prefix}Total`] = null;
    }
    s.cpuSource = typeof s.cpuSource === 'string' ? s.cpuSource.slice(0, 128) : '';
    s.gpuName = typeof s.gpuName === 'string' ? s.gpuName.slice(0, 128) : '';
    return s;
}
export function temperature(value, kind) {
    if (!validNumber(value, 150)) return {text: '—', ratio: 0, color: COLORS.unavailable, state: 'Unavailable'};
    const levels = kind === 'cpu' ? [65, 80, 90] : [55, 70, 83];
    const level = levels.filter(limit => value >= limit).length;
    return {text: `${Math.round(value)}°`, ratio: Math.min(value / 100, 1),
        color: [COLORS.cool, COLORS.warm, COLORS.hot, COLORS.critical][level],
        state: ['Cool', 'Warm', 'Hot', 'Very hot'][level]};
}
export function memory(used, total, kind, percent = false) {
    if (!validNumber(used) || !validNumber(total) || total === 0 || used > total)
        return {text: '—', ratio: 0, color: COLORS.unavailable, detail: 'Unavailable'};
    const ratio = used / total;
    const amount = used / GIB;
    return {
        text: percent ? `${Math.round(ratio * 100)}%` : `${amount < 100 ? amount.toFixed(1) : Math.round(amount)}G`,
        ratio,
        color: ratio >= 0.92 ? COLORS.critical : ratio >= 0.8 ? COLORS.warm : COLORS[kind],
        detail: `${amount.toFixed(1)} / ${(total / GIB).toFixed(1)} GiB · ${Math.round(ratio * 100)}%`,
    };
}
