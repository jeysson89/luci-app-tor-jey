'use strict';
'require view';
'require rpc';
'require uci';
'require dom';

var callStatus = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'status' });
var callConfig = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'config' });
var callTraffic = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'traffic' });
var callUciGet = rpc.declare({ nobatch: true, object: 'uci', method: 'get', params: [ 'config' ], expect: { values: {} } });

var samples = [];
var lastTotal = null;
var lastTime = 0;
var chart = null;

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

function fmtUptime(sec) {
	sec = Number(sec) || 0;
	var d = Math.floor(sec / 86400),
	    h = Math.floor((sec % 86400) / 3600),
	    m = Math.floor((sec % 3600) / 60),
	    s = Math.floor(sec % 60),
	    out = [];

	if (d) out.push(d + 'd');
	if (d || h) out.push(h + 'h');
	if (d || h || m) out.push(m + 'm');
	out.push(s + 's');
	return out.join(' ');
}

/* SVG-элементы: E() в LuCI создаёт обычные HTML-узлы, поэтому нужен createElementNS */
function S(tag, attrs, children) {
	var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (var k in attrs) {
		if (attrs[k] != null) node.setAttribute(k, attrs[k]);
	}
	(children || []).forEach(function(c) {
		node.appendChild((typeof c === 'string') ? document.createTextNode(c) : c);
	});
	return node;
}

function badge(text, kind) {
	return E('span', { 'class': 'tor-badge tor-badge-' + kind }, [ text ]);
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
		return Promise.all([ callStatus(), callConfig(), callUciGet('tor_pro') ]);
	},

	unload: function() {
		if (this.fastTimer) { window.clearInterval(this.fastTimer); this.fastTimer = null; }
		if (this.pollTimer) { window.clearInterval(this.pollTimer); this.pollTimer = null; }
		if (this.visHandler) { document.removeEventListener('visibilitychange', this.visHandler); this.visHandler = null; }
	},

	render: function(data) {
		var self = this;
		var st = data[0] || {};
		var cfg = data[1] || {};
		var settings = (data[2] && data[2]['settings']) || {};
		var interval = parseInt(settings.refresh, 10) || 5;
		var auto = (settings.monitor_enabled !== '0');

		var wrap = E('div', { 'class': 'tor-wrap' });

		/* ---------- панель управления ---------- */
		var autoBox = E('input', { 'type': 'checkbox', 'id': 'tor_auto' });
		if (auto) autoBox.checked = 'checked';

		wrap.appendChild(E('div', { 'class': 'tor-toolbar' }, [
			E('label', { 'for': 'tor_auto' }, [ autoBox, E('span', {}, [ _('Auto refresh') ]) ]),
			E('span', { 'class': 'tor-dim' }, [ _('Interval') + ': ' + interval + ' ' + _('s') ]),
			E('span', { 'style': 'flex:1' }),
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': function(ev) { ev.preventDefault(); self.update(); }
			}, [ _('Refresh') ])
		]));

		/* ---------- состояние ---------- */
		var cState = card(_('Service status'));
		var stateGrid = E('div', { 'class': 'tor-grid' });
		cState.body.appendChild(stateGrid);
		wrap.appendChild(cState.box);

		/* ---------- трафик ---------- */
		var cTraffic = card(_('Traffic through Tor'));
		var chartBox = E('div', { 'class': 'tor-chart-box' });
		var legend = E('div', { 'class': 'tor-chart-legend' });
		var trafficTable = E('div', {});
		cTraffic.body.appendChild(chartBox);
		cTraffic.body.appendChild(legend);
		cTraffic.body.appendChild(E('div', { 'style': 'margin-top:14px' }, [ trafficTable ]));
		wrap.appendChild(cTraffic.box);

		/* ---------- мосты ---------- */
		/* раздел «Активные мосты» убран: список и статистика живёт во вкладке «Мосты» */

		/* элементы управления — прямые ссылки, без поиска по документу */
		this.ui = {
			stateGrid: stateGrid,
			chartBox: chartBox,
			legend: legend,
			trafficTable: trafficTable
		};

		/* график создаём сразу, пока узлы в нашем дереве */
		chart = this.makeChart(chartBox);

		this.renderData = function(st, cfg) {
			self.renderState(st);
			self.renderTraffic(st);
		};

		this.alive = function() {
			return this.ui && this.ui.stateGrid && this.ui.stateGrid.isConnected;
		};

		this.update = function() {
			if (!self.alive()) return;
			return Promise.all([ callStatus(), callConfig() ]).then(function(res) {
				self.renderData(res[0], res[1]);
			}).catch(function(e) {
				console.error('tor status:', e);
			});
		};

		/* быстрый канал графика: лёгкий RPC traffic (~1,5 c),
		   полный status остаётся на обычном интервале */
		this.fastUpdate = function() {
			if (!self.alive()) {
				if (self.fastTimer) { window.clearInterval(self.fastTimer); self.fastTimer = null; }
				return;
			}
			return callTraffic().then(function(tr) {
				self.renderTraffic(tr);
			}).catch(function() {});
		};

		this.renderData(st, cfg);

		/* свои таймеры вместо глобального poll'а LuCI: он опирается на
		   requestAnimationFrame и замирает в фоновой вкладке */
		if (auto) {
			this.pollTimer = window.setInterval(function() { self.update(); }, interval * 1000);
			this.fastTimer = window.setInterval(function() { self.fastUpdate(); }, 1500);
		}

		/* при возврате на вкладку сразу обновить данные */
		this.visHandler = function() {
			if (!document.hidden && self.alive())
				self.update();
		};
		document.addEventListener('visibilitychange', this.visHandler);

		return E('div', {}, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/tor/tor2.css') }),
			wrap
		]);
	},

	makeChart: function(box) {
		var w = 800, h = 200;
		var svg = S('svg', {
			'class': 'tor-chart', 'viewBox': '0 0 ' + w + ' ' + h,
			'preserveAspectRatio': 'none'
		});

		var grid = S('g', {});
		for (var i = 1; i < 4; i++) {
			var y = (h / 4) * i;
			grid.appendChild(S('line', { x1: 0, y1: y, x2: w, y2: y }));
		}

		var area = S('path', { 'class': 'area' });
		var line = S('polyline', { 'class': 'line' });
		var labels = S('g', {});

		svg.appendChild(grid);
		svg.appendChild(area);
		svg.appendChild(line);
		svg.appendChild(labels);
		box.appendChild(svg);

		return { svg: svg, area: area, line: line, labels: labels, w: w, h: h };
	},

	drawChart: function(rate) {
		if (!chart) return;

		samples.push(Math.max(0, rate || 0));
		if (samples.length > 120) samples.shift();

		var w = chart.w, h = chart.h, n = samples.length;
		var max = 1024;
		samples.forEach(function(v) { if (v > max) max = v; });
		max *= 1.15;

		var pts = samples.map(function(v, i) {
			var x = n > 1 ? (i / (n - 1)) * w : w;
			var y = h - (v / max) * (h - 10) - 5;
			return x.toFixed(1) + ',' + y.toFixed(1);
		});

		chart.line.setAttribute('points', pts.join(' '));
		chart.area.setAttribute('d', 'M0,' + h + ' L' + pts.join(' L') + ' L' + w + ',' + h + ' Z');

		dom.content(chart.labels, [
			S('text', { 'class': 'axis-label', x: 6, y: 14 }, [ fmtRate(max) ]),
			S('text', { 'class': 'axis-label', x: 6, y: h - 6 }, [ '0' ])
		]);

		var sum = 0, mx = 0;
		samples.forEach(function(v) { sum += v; if (v > mx) mx = v; });
		var avg = samples.length ? sum / samples.length : 0;
		dom.content(this.ui.legend, [
			E('span', {}, [ _('max') + ': ' + fmtRate(mx) ]),
			E('span', {}, [ _('avg') + ': ' + fmtRate(avg) ]),
			E('span', {}, [ samples.length + ' ' + _('samples') ])
		]);
	},

	renderState: function(st) {
		var tor = st.tor || {};
		dom.content(this.ui.stateGrid, [
			E('div', { 'class': 'tor-stat' }, [
				E('div', { 'class': 'tor-stat-label' }, [ _('Daemon') ]),
				E('div', { 'class': 'tor-stat-value' }, [ badge(tor.running ? _('running') : _('stopped'),
					tor.running ? 'ok' : 'bad') ]),
				E('div', { 'class': 'tor-stat-sub' }, [ tor.pid ? 'PID ' + tor.pid : '' ])
			]),
			stat(_('Uptime'), tor.running ? fmtUptime(tor.uptime) : '—'),
			stat(_('Bootstrap'), tor.bootstrap ? tor.bootstrap + '%' : '—'),
			stat(_('Guard'), tor.guard ? tor.guard : '—', []),
			stat(_('Bridges'), String((st.bridges || []).length),
				st.use_bridges ? _('bridges enabled') : _('direct connection')),
			stat(_('Clients'), String(st.clients || 0), _('routed via Tor'))
		]);
	},

	renderTraffic: function(st) {
		/* сюда приходит либо полный статус (st.traffic), либо лёгкий
		   объект из RPC traffic — сами счётчики */
		var tr = st.traffic || st || {};
		var totalB = Number(tr.bytes) || 0;
		var now = (new Date()).getTime() / 1000;
		var rate = 0;

		if (lastTotal !== null) {
			var dt = now - lastTime;
			if (dt > 0) {
				var d = totalB - lastTotal;
				rate = d > 0 ? d / dt : 0;
			}
		}
		lastTotal = totalB;
		lastTime = now;

		this.drawChart(rate);

		dom.content(this.ui.trafficTable, E('table', { 'class': 'tor-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Channel') ]),
				E('th', { 'class': 'tor-num' }, [ _('Packets') ]),
				E('th', { 'class': 'tor-num' }, [ _('Total') ])
			]) ]),
			E('tbody', {}, [
				E('tr', {}, [
					E('td', {}, [ _('All traffic via Tor') ]),
					E('td', { 'class': 'tor-num' }, [ String(tr.packets || 0) ]),
					E('td', { 'class': 'tor-num' }, [ fmtBytes(totalB) ])
				]),
				E('tr', {}, [
					E('td', {}, [ 'TCP (TransPort)' ]),
					E('td', { 'class': 'tor-num' }, [ String(tr.tcp_packets || 0) ]),
					E('td', { 'class': 'tor-num' }, [ fmtBytes(tr.tcp_bytes) ])
				]),
				E('tr', {}, [
					E('td', {}, [ 'DNS (DNSPort)' ]),
					E('td', { 'class': 'tor-num' }, [ String(tr.dns_packets || 0) ]),
					E('td', { 'class': 'tor-num' }, [ fmtBytes(tr.dns_bytes) ])
				])
			])
		]));
	}
});
