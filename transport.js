import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {decodeSample} from './model.js';

// Exactly one child and one request at a time. All pipe I/O is asynchronous.
// A hung driver is isolated from Shell and killed after eight seconds.
export class SensorClient {
    constructor(path, onSample, onUnavailable) {
        this._path = path;
        this._onSample = onSample;
        this._onUnavailable = onUnavailable;
        this._timer = 0;
        this._cancel = new Gio.Cancellable();
        this._child = null;
        this._pending = false;
        this._retryAt = 0;
        this._failures = 0;
    }
    _spawn() {
        this._child = Gio.Subprocess.new([this._path],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        this._input = this._child.get_stdin_pipe();
        this._output = new Gio.DataInputStream({base_stream: this._child.get_stdout_pipe()});
        this._io = new Gio.Cancellable();
        const child = this._child;
        child.wait_async(null, (source, result) => {
            try { source.wait_finish(result); } catch (e) { console.warn(`Astro Vitals: ${e.message}`); }
            if (this._child === child && !this._cancel.is_cancelled()) this._fail();
        });
    }
    request() {
        if (this._cancel.is_cancelled() || this._pending || GLib.get_monotonic_time() < this._retryAt) return;
        try { if (!this._child) this._spawn(); } catch (e) { this._fail(); return; }
        this._pending = true;
        const child = this._child, io = this._io;
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
            this._timer = 0;
            this._fail();
            return GLib.SOURCE_REMOVE;
        });
        this._input.write_all_async(new TextEncoder().encode('sample\n'), GLib.PRIORITY_DEFAULT, io,
            (stream, result) => {
                try { stream.write_all_finish(result); }
                catch (e) { if (this._child === child) this._fail(); return; }
                if (this._child !== child || io.is_cancelled()) return;
                this._output.read_line_async(GLib.PRIORITY_DEFAULT, io, (output, readResult) => {
                    try {
                        const [line] = output.read_line_finish_utf8(readResult);
                        if (this._child !== child || io.is_cancelled()) return;
                        if (line === null) throw new Error('Sensor stream ended');
                        const sample = decodeSample(line);
                        this._clearDeadline();
                        this._pending = false;
                        this._failures = 0;
                        this._onSample(sample);
                    } catch (e) { if (this._child === child) this._fail(); }
                });
            });
    }
    _clearDeadline() {
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
    }
    _stopChild() {
        this._clearDeadline();
        const child = this._child;
        this._child = null;
        this._io?.cancel();
        child?.force_exit();
        this._input = this._output = this._io = null;
        this._pending = false;
    }
    _fail() {
        this._stopChild();
        if (this._cancel.is_cancelled()) return;
        this._retryAt = GLib.get_monotonic_time() + Math.min(60, 3 * 2 ** Math.min(this._failures++, 5)) * 1e6;
        this._onUnavailable();
    }
    destroy() {
        this._cancel.cancel();
        this._stopChild();
        this._onSample = this._onUnavailable = null;
    }
}
