'use strict';
'require view';
'require rpc';
'require dom';

var callLogRead = rpc.declare({ nobatch: true,
	object: 'log',
	method: 'read',
	params: [ 'lines', 'stream', 'oneshot' ],
	expect: { log: [] }
});

var lines = [];
var tail = true;

function fmtTime(ts) {
	var d = new Date(ts * 1000);
	var p = function(n) { return (n < 10 ? '0' : '') + n; };
	return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function prioName(p) {
	var names = [ 'emerg', 'alert', 'crit', 'err', 'warn', 'notice', 'info', 'debug' ];
	return names[p % 8] || 'info';
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function() {
		return callLogRead(300, false, true).catch(function() { return []; });
	},

	render: function(data) {
		var self = this;
		lines = (data || []).map(function(e) {
			return { t: e.time, p: e.priority, m: e.msg };
		});

		var wrap = E('div', { 'class': 'tor-wrap' });

		/* панель фильтров */
		var filter = E('input', {
			'type': 'text', 'id': 'tor_log_filter',
			'placeholder': _('filter text'), 'style': 'min-width:220px'
		});
		var tailBox = E('input', { 'type': 'checkbox', 'id': 'tor_log_tail', 'class': 'cbi-input-checkbox' });
		tailBox.checked = 'checked';
		tailBox.addEventListener('change', function() { tail = tailBox.checked; self.draw(); });

		var toolbar = E('div', { 'class': 'tor-toolbar' }, [
			E('label', { 'for': 'tor_log_filter' }, [ filter ]),
			E('label', { 'for': 'tor_log_tail' }, [ tailBox, E('span', {}, [ _('Follow') ]) ]),
			E('span', { 'style': 'flex:1' }),
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': function(ev) { ev.preventDefault(); self.update(true); }
			}, [ _('Refresh') ])
		]);
		wrap.appendChild(toolbar);

		/* карточка лога */
		var area = E('textarea', {
			'id': 'tor_log', 'readonly': 'readonly', 'wrap': 'off', 'rows': '28',
			'style': 'width:100%;font-family:var(--font-mono);font-size:12px;line-height:1.45;' +
				'background:var(--background-color-low);border:1px solid var(--border-color);border-radius:8px;padding:12px'
		});

		var card = E('div', { 'class': 'tor-card' }, [
			E('div', { 'class': 'tor-card-head' }, [
				E('h3', { 'class': 'tor-card-title' }, [ _('Tor Log') ]),
				E('span', { 'class': 'tor-dim', 'id': 'tor_log_count' }, [ '' ])
			]),
			area
		]);
		wrap.appendChild(card);

		filter.addEventListener('input', function() { self.draw(); });

		this.draw = function() {
			var needle = filter.value.toLowerCase();
			var out = [];
			lines.forEach(function(l) {
				var text = '[' + fmtTime(l.t) + '] ' + prioName(l.p) + ': ' + l.m;
				if (l.m.toLowerCase().indexOf('tor') === -1) return;
				if (needle && text.toLowerCase().indexOf(needle) === -1) return;
				out.push(text);
			});
			area.value = out.join('\n');
			var cnt = document.getElementById('tor_log_count');
			if (cnt) cnt.textContent = out.length + ' ' + _('lines');
			if (tail) area.scrollTop = area.scrollHeight;
		};

		this.update = function(reset) {
			return callLogRead(300, false, true).then(function(data) {
				var fresh = (data || []).map(function(e) {
					return { t: e.time, p: e.priority, m: e.msg };
				});
				if (reset) {
					lines = fresh;
				} else {
					lines = fresh.concat(lines);
					if (lines.length > 2000) lines = lines.slice(0, 2000);
				}
				self.draw();
			}).catch(function(e) {
				console.error('tor log:', e);
			});
		};

		this.draw();

		/* свой таймер вместо глобального poll'а LuCI (он замирает в фоновой вкладке);
		   criterion — textarea лога остаётся в дереве документа */
		this.pollTimer = window.setInterval(function() {
			if (area && area.isConnected)
				self.update(false);
		}, 5000);

		return E('div', {}, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/tor/tor2.css') }),
			wrap
		]);
	},

	unload: function() {
		if (this.pollTimer) { window.clearInterval(this.pollTimer); this.pollTimer = null; }
	}
});
