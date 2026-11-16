import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Pango from 'gi://Pango';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {SensorClient} from './transport.js';
import {temperature, memory} from './model.js';

// This extension is built locally for personal use on GNOME 50.
class Metric {
    constructor(name, width) {
        this.actor = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER,
            style_class: 'astro-metric', width});
        const row = new St.BoxLayout({style_class: 'astro-row', x_expand: true});
        this.caption = new St.Label({text: name, style_class: 'astro-caption', y_align: Clutter.ActorAlign.CENTER});
        this.value = new St.Label({text: '—', style_class: 'astro-value',
            x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        const digits = new Pango.AttrList();
        digits.insert(Pango.attr_font_features_new('tnum'));
        this.value.clutter_text.set_attributes(digits);
        row.add_child(this.caption);
        row.add_child(this.value);
        this.track = new St.Widget({layout_manager: new Clutter.BinLayout(),
            style_class: 'astro-track', height: 2, x_expand: true});
        this.fill = new St.Widget({style_class: 'astro-fill', x_expand: true, y_expand: true,
            scale_x: 0});
        this.fill.set_pivot_point(0, 0.5);
        this.track.add_child(this.fill);
        this.actor.add_child(row);
        this.actor.add_child(this.track);
        this._ratio = -1;
    }
    update(metric, animate) {
        if (this.value.text !== metric.text) this.value.text = metric.text;
        if (this._color !== metric.color) {
            this._color = metric.color;
            this.value.set_style(`color: ${metric.color};`);
            this.fill.set_style(`background-color: ${metric.color};`);
        }
        if (Math.abs(this._ratio - metric.ratio) > 0.002) {
            this.fill.remove_all_transitions();
            this.fill.ease({scale_x: metric.ratio, duration: animate && this._ratio >= 0 ? 260 : 0,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            this._ratio = metric.ratio;
        }
    }
}

const VitalsIndicator = GObject.registerClass(
class AstroVitalsIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Astro Vitals');
        this.add_style_class_name('astro-vitals');
        this._extension = extension;
        this._settings = extension.getSettings();
        this._sample = null;
        this._tick = 0;
        const box = new St.BoxLayout({style_class: 'astro-strip', y_align: Clutter.ActorAlign.CENTER});
        this._metrics = [new Metric('CPU', 70), new Metric('GPU', 70), new Metric('RAM', 83), new Metric('VRAM', 88)];
        this._metrics.forEach((metric, index) => {
            if (index > 0) box.add_child(new St.Widget({style_class: 'astro-divider',
                width: 1, height: 12, y_align: Clutter.ActorAlign.CENTER}));
            box.add_child(metric.actor);
        });
        this.add_child(box);
        this._buildMenu();
        this._client = new SensorClient(`${extension.path}/astro-sensors`, sample => {
            this._sample = sample;
            this._render();
        }, () => {
            this._sample = null;
            this._render();
        });
        this._settingsId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'refresh-seconds') this._schedule();
            if (key === 'animations') this._animationSwitch.setToggleState(this._settings.get_boolean(key));
            if (key === 'memory-percent') this._percentSwitch.setToggleState(this._settings.get_boolean(key));
            this._render();
        });
        this._menuId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._renderDetails();
        });
        this._render();
        this._schedule();
    }
    _buildMenu() {
        this.menu.actor.add_style_class_name('astro-menu');
        this.menu.box.add_style_class_name('astro-menu-content');
        const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const title = new St.BoxLayout({vertical: true, style_class: 'astro-menu-heading'});
        title.add_child(new St.Label({text: 'Astro Vitals', style_class: 'astro-menu-title'}));
        this._subtitle = new St.Label({text: 'Connecting to sensors…', style_class: 'astro-menu-subtitle'});
        title.add_child(this._subtitle);
        header.add_child(title);
        this.menu.addMenuItem(header);
        this._details = [];
        for (const name of ['CPU temperature', 'GPU temperature', 'Memory', 'GPU memory']) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            const label = new St.Label({text: name, x_expand: true, style_class: 'astro-detail-label'});
            const value = new St.Label({text: '—', style_class: 'astro-detail-value'});
            item.add_child(label);
            item.add_child(value);
            this.menu.addMenuItem(item);
            this._details.push(value);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refresh = new PopupMenu.PopupSubMenuMenuItem('Refresh rate');
        this._rateItems = [];
        for (const [seconds, label] of [[2, 'Responsive · 2 seconds'], [3, 'Balanced · 3 seconds'], [5, 'Quiet · 5 seconds'], [10, 'Minimal · 10 seconds']]) {
            const item = refresh.menu.addAction(label, () => this._settings.set_int('refresh-seconds', seconds));
            this._rateItems.push([seconds, item]);
        }
        this.menu.addMenuItem(refresh);
        this._animationSwitch = new PopupMenu.PopupSwitchMenuItem('Gentle animations', this._settings.get_boolean('animations'));
        this._animationSwitch.connect('toggled', (_item, state) => this._settings.set_boolean('animations', state));
        this.menu.addMenuItem(this._animationSwitch);
        this._percentSwitch = new PopupMenu.PopupSwitchMenuItem('Memory as percentage', this._settings.get_boolean('memory-percent'));
        this._percentSwitch.connect('toggled', (_item, state) => this._settings.set_boolean('memory-percent', state));
        this.menu.addMenuItem(this._percentSwitch);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const note = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        note.add_child(new St.Label({text: '° Celsius   ·   G = GiB   ·   Colors indicate heat / capacity', style_class: 'astro-menu-note'}));
        this.menu.addMenuItem(note);
    }
    _schedule() {
        if (this._tick) GLib.Source.remove(this._tick);
        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._settings.get_int('refresh-seconds'), () => {
            // Shell disables user extensions when locked. No sensor child survives disable().
            if (this.mapped) this._client.request();
            return GLib.SOURCE_CONTINUE;
        });
        this._client.request();
    }
    _render() {
        const s = this._sample ?? {};
        const percent = this._settings.get_boolean('memory-percent');
        const metrics = [temperature(s.cpuTemp, 'cpu'), temperature(s.gpuTemp, 'gpu'),
            memory(s.ramUsed, s.ramTotal, 'ram', percent), memory(s.vramUsed, s.vramTotal, 'vram', percent)];
        const animate = this._settings.get_boolean('animations') && St.Settings.get().enable_animations && this.mapped;
        metrics.forEach((metric, i) => this._metrics[i].update(metric, animate));
        this.accessible_name = `Astro Vitals. CPU ${metrics[0].text} Celsius, ${metrics[0].state}. GPU ${metrics[1].text} Celsius, ${metrics[1].state}. RAM ${metrics[2].detail}. GPU memory ${metrics[3].detail}.`;
        if (this.menu.isOpen) this._renderDetails();
    }
    _renderDetails() {
        const s = this._sample ?? {};
        const cpu = temperature(s.cpuTemp, 'cpu'), gpu = temperature(s.gpuTemp, 'gpu');
        this._subtitle.text = s.gpuName || 'Sensors unavailable · retrying automatically';
        const details = [s.cpuTemp == null ? 'Unavailable' : `${s.cpuTemp.toFixed(1)} °C · ${cpu.state}`,
            s.gpuTemp == null ? 'Unavailable' : `${s.gpuTemp.toFixed(0)} °C · ${gpu.state}`,
            memory(s.ramUsed, s.ramTotal, 'ram').detail,
            memory(s.vramUsed, s.vramTotal, 'vram').detail];
        details.forEach((text, i) => { this._details[i].text = text; });
        for (const [seconds, item] of this._rateItems)
            item.setOrnament(seconds === this._settings.get_int('refresh-seconds') ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
    }
    destroy() {
        if (this._tick) GLib.Source.remove(this._tick);
        this._tick = 0;
        this._client.destroy();
        this._settings.disconnect(this._settingsId);
        this.menu.disconnect(this._menuId);
        this._client = this._sample = this._settings = this._extension = null;
        for (const metric of this._metrics) metric.fill.remove_all_transitions();
        super.destroy();
    }
});

export default class AstroVitalsExtension extends Extension {
    enable() {
        this._indicator = new VitalsIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
