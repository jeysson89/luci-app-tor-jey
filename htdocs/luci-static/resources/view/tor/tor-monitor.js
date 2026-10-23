'use strict';
'require view';
'require rpc';
'require uci';
'require dom';

var callMonitor = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'monitor' });
var callStatus = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'status' });
var callDest = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'destinations' });
var callUciGet = rpc.declare({ nobatch: true, object: 'uci', method: 'get', params: [ 'config' ], expect: { values: {} } });

var last = {};
var lastTime = 0;

function fmtBytes(n) {
	n = Number(n) || 0;
	if (n < 1024) return n + ' B';
	if (n < 1048576) return (n / 1024).toFixed(1) + ' KiB';
	if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MiB';
	return (n / 1073741824).toFixed(2) + ' GiB';
}

function fmtRate(bps) {
	bps = Number(bps) || 0;
	if (bps < 1024) return bps.toFixed(0) + ' B/s';
	if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KiB/s';
	return (bps / 1048576).toFixed(2) + ' MiB/s';
}

function stat(label, value, sub) {
	return E('div', { 'class': 'tor-stat' }, [
		E('div', { 'class': 'tor-stat-label' }, [ label ]),
		E('div', { 'class': 'tor-stat-value' }, [ value ]),
		sub ? E('div', { 'class': 'tor-stat-sub' }, [ sub ]) : ''
	]);
}

function card(title, right) {
	var head = E('div', { 'class': 'tor-card-head' }, [ E('h3', { 'class': 'tor-card-title' }, [ title ]) ]);
	if (right) head.appendChild(right);
	var body = E('div', {});
	return { box: E('div', { 'class': 'tor-card' }, [ head, body ]), body: body };
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function() {
		return Promise.all([ callUciGet('tor_pro'), callMonitor(), callStatus(), callDest() ]);
	},

	render: function(data) {
		var self = this;
		var settings = (data[0] && data[0]['settings']) || {};
		var interval = parseInt(settings.refresh, 10) || 5;
		var auto = (settings.monitor_enabled !== '0');

		var wrap = E('div', { 'class': 'tor-wrap' });

		/* ---------- панель фильтров ---------- */
		var autoBox = E('input', { 'type': 'checkbox', 'id': 'tor_mon_auto' });
		if (auto) autoBox.checked = 'checked';
		var filter = E('input', {
			'type': 'text', 'id': 'tor_mon_filter',
			'placeholder': _('device name or IP'), 'style': 'min-width:200px'
		});

		wrap.appendChild(E('div', { 'class': 'tor-toolbar' }, [
			E('label', { 'for': 'tor_mon_auto' }, [ autoBox, E('span', {}, [ _('Auto refresh') ]) ]),
			E('span', { 'class': 'tor-dim' }, [ _('Interval') + ': ' + interval + ' ' + _('s') ]),
			E('label', { 'for': 'tor_mon_filter', 'style': 'gap:6px' }, [ filter ]),
			E('span', { 'style': 'flex:1' }),
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': function(ev) { ev.preventDefault(); self.update(); }
			}, [ _('Refresh') ])
		]));

		/* ---------- сводка ---------- */
		var cSum = card(_('Summary'));
		var sumGrid = E('div', { 'class': 'tor-grid' });
		cSum.body.appendChild(sumGrid);
		wrap.appendChild(cSum.box);

		/* ---------- по устройствам ---------- */
		var cDev = card(_('Traffic by device'));
		var devBox = E('div', {});
		cDev.body.appendChild(devBox);
		wrap.appendChild(cDev.box);

		/* ---------- назначения ---------- */
		var cDest = card(_('Destinations via Tor'));
		var destBox = E('div', {});
		cDest.body.appendChild(destBox);
		wrap.appendChild(cDest.box);

		this.ui = { sumGrid: sumGrid, devBox: devBox, destBox: destBox, filter: filter };
		this.data = { mon: data[1], st: data[2], dest: data[3] };

		filter.addEventListener('input', function() {
			self.renderDevices();
			self.renderDestinations();
		});

		this.update = function() {
			return Promise.all([ callMonitor(), callStatus(), callDest() ]).then(function(res) {
				self.data = { mon: res[0], st: res[1], dest: res[2] };
				self.renderAll();
			}).catch(function(e) {
				console.error('tor monitor:', e);
			});
		};

		this.renderAll = function() {
			self.renderSummary();
			self.renderDevices();
			self.renderDestinations();
		};

		this.renderAll();

		/* свой таймер вместо глобального poll'а LuCI (он замирает в фоновой вкладке) */
		this.pollTimer = window.setInterval(function() {
			if (self.ui && self.ui.sumGrid && self.ui.sumGrid.isConnected)
				self.update();
		}, interval * 1000);

		return E('div', {}, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/tor/tor2.css') }),
			wrap
		]);
	},

	unload: function() {
		if (this.pollTimer) { window.clearInterval(this.pollTimer); this.pollTimer = null; }
	},

	renderSummary: function() {
		var st = (this.data && this.data.st) || {};
		var tr = st.traffic || {};
		var devices = ((this.data && this.data.mon) && this.data.mon.devices) || [];

		var totalB = Number(tr.bytes) || 0;
		var now = (new Date()).getTime() / 1000;
		var rate = 0;

		if (last.total !== undefined) {
			var dt = now - lastTime;
			if (dt > 0) {
				var d = totalB - last.total;
				rate = d > 0 ? d / dt : 0;
			}
		}
		last.total = totalB;
		lastTime = now;

		var active = devices.filter(function(d) { return (d.bytes || 0) > 0; }).length;

		dom.content(this.ui.sumGrid, [
			stat(_('Total traffic'), fmtBytes(totalB), fmtRate(rate) + ' ' + _('now')),
			stat(_('Packets'), String(tr.packets || 0), _('all clients')),
			stat(_('Active devices'), String(active), _('of') + ' ' + devices.length),
			stat(_('Through Tor'), String(devices.length), _('monitored clients'))
		]);
	},

	renderDevices: function() {
		var mon = (this.data && this.data.mon) || {};
		var list = mon.devices || [];
		var needle = (this.ui.filter.value || '').toLowerCase();

		var now = (new Date()).getTime() / 1000;
		var maxBytes = 0;
		list.forEach(function(d) { if ((d.bytes || 0) > maxBytes) maxBytes = d.bytes; });

		var rows = [];

		list.forEach(function(d) {
			if (needle) {
				var hay = ((d.name || '') + ' ' + (d.ip || '')).toLowerCase();
				if (hay.indexOf(needle) === -1) return;
			}

			var bytes = Number(d.bytes) || 0;
			var rate = 0;
			if (last[d.ip] !== undefined) {
				var dt = now - lastTime;
				if (dt > 0) {
					var diff = bytes - last[d.ip];
					rate = diff > 0 ? diff / dt : 0;
				}
			}
			last[d.ip] = bytes;

			var share = maxBytes > 0 ? Math.round((bytes / maxBytes) * 100) : 0;

			rows.push(E('tr', {}, [
				E('td', {}, [ d.name || E('span', { 'class': 'tor-dim' }, [ _('unknown device') ]) ]),
				E('td', { 'class': 'tor-mono' }, [ d.ip ]),
				E('td', { 'class': 'tor-num' }, [ String(d.packets || 0) ]),
				E('td', { 'class': 'tor-num' }, [ fmtBytes(bytes) ]),
				E('td', { 'class': 'tor-num' }, [ fmtRate(rate) ]),
				E('td', { 'style': 'width:140px' }, [
					E('div', { 'class': 'tor-bar' }, [ E('i', { 'style': 'width:' + share + '%' }) ])
				])
			]));
		});

		if (!rows.length) {
			rows.push(E('tr', {}, [ E('td', { 'colspan': '6', 'class': 'tor-empty' },
				[ mon.available === false
					? _('Traffic counters are not available. Apply the routing settings to enable monitoring.')
					: _('No traffic through Tor yet') ]) ]));
		}

		dom.content(this.ui.devBox, E('table', { 'class': 'tor-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Device') ]),
				E('th', {}, [ _('IP address') ]),
				E('th', { 'class': 'tor-num' }, [ _('Packets') ]),
				E('th', { 'class': 'tor-num' }, [ _('Traffic') ]),
				E('th', { 'class': 'tor-num' }, [ _('Speed') ]),
				E('th', {}, [ _('Share') ])
			]) ]),
			E('tbody', {}, rows)
		]));
	},

	renderDestinations: function() {
		var dest = (this.data && this.data.dest) || {};
		var list = dest.destinations || [];
		var needle = (this.ui.filter.value || '').toLowerCase();
		var names = {};

		((this.data && this.data.mon) && this.data.mon.devices || []).forEach(function(d) {
			names[d.ip] = d.name;
		});

		var rows = [];

		list.forEach(function(d) {
			if (needle) {
				var hay = ((names[d.ip] || '') + ' ' + d.ip + ' ' + d.dst).toLowerCase();
				if (hay.indexOf(needle) === -1) return;
			}
			rows.push(E('tr', {}, [
				E('td', {}, [ names[d.ip] || E('span', { 'class': 'tor-dim' }, [ _('unknown device') ]) ]),
				E('td', { 'class': 'tor-mono' }, [ d.ip ]),
				E('td', { 'class': 'tor-mono' }, [ d.dst ]),
				E('td', { 'class': 'tor-num' }, [ d.port || '—' ]),
				E('td', { 'class': 'tor-num' }, [ String(d.packets || 0) ]),
				E('td', { 'class': 'tor-num' }, [ fmtBytes(d.bytes) ])
			]));
		});

		if (!rows.length) {
			rows.push(E('tr', {}, [ E('td', { 'colspan': '6', 'class': 'tor-empty' },
				[ _('No traffic through Tor yet') ]) ]));
		}

		dom.content(this.ui.destBox, E('table', { 'class': 'tor-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Device') ]),
				E('th', {}, [ _('IP address') ]),
				E('th', {}, [ _('Destination') ]),
				E('th', { 'class': 'tor-num' }, [ _('Port') ]),
				E('th', { 'class': 'tor-num' }, [ _('Packets') ]),
				E('th', { 'class': 'tor-num' }, [ _('Traffic') ])
			]) ]),
			E('tbody', {}, rows)
		]));
	}
});
