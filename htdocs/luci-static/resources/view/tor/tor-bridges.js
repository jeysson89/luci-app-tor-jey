'use strict';
'require view';
'require rpc';
'require ui';
'require dom';
'require uci';

var callApply = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'apply-bridges' });
var callTest = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'test-bridge', params: [ 'address', 'url' ] });
var callStatus = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'status' });
var callBridgeMon = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'bridge-mon' });
var callMonNow = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'bridge-mon-now' });

var callUciGet = rpc.declare({ nobatch: true, object: 'uci', method: 'get', params: [ 'config' ], expect: { values: {} } });
var callUciSet = rpc.declare({ nobatch: true, object: 'uci', method: 'set', params: [ 'config', 'section', 'values' ] });
var callUciAdd = rpc.declare({ nobatch: true, object: 'uci', method: 'add',
	params: [ 'config', 'type', 'name', 'values' ], expect: { section: '' } });
var callUciDelete = rpc.declare({ nobatch: true, object: 'uci', method: 'delete', params: [ 'config', 'section', 'options' ] });
var callUciCommit = rpc.declare({ nobatch: true, object: 'uci', method: 'commit', params: [ 'config' ] });

/* параметры каждого типа моста */
var TYPES = {
	vanilla: {
		title: 'Vanilla',
		fields: [ 'addr', 'fingerprint' ],
		tpl: 'Bridge 192.0.2.5:443'
	},
	obfs4: {
		title: 'obfs4',
		fields: [ 'addr', 'fingerprint', 'cert', 'iat' ],
		tpl: 'Bridge obfs4 192.0.2.5:443 FINGERPRINT cert=CERTIFICATE iat-mode=0'
	},
	snowflake: {
		title: 'snowflake',
		fields: [ 'addr', 'fingerprint', 'url', 'ice', 'extra' ],
		tpl: 'Bridge snowflake 192.0.2.5:443 FINGERPRINT url=https://.../ ice=stun:...'
	},
	'meek-azure': {
		title: 'meek-azure',
		fields: [ 'addr', 'url', 'extra' ],
		tpl: 'Bridge meek-azure 192.0.2.5:443 url=https://.../'
	}
};
TYPES.vanilla.fields.push('extra');

/* подписи и подсказки полей (строки в _() — чтобы их видел i18n-scan) */
function fieldLabel(f) {
	switch (f) {
	case 'addr': return _('Address');
	case 'fingerprint': return _('Fingerprint');
	case 'url': return _('URL');
	case 'ice': return _('ICE servers');
	case 'cert': return _('Certificate');
	case 'iat': return _('iat-mode');
	case 'extra': return _('Extra parameters');
	case 'comment': return _('Comment');
	}
	return f;
}

function fieldHint(f) {
	switch (f) {
	case 'addr': return _('host:port of the bridge');
	case 'fingerprint': return _('40 hex characters, mandatory for obfs4');
	case 'url': return _('pluggable transport endpoint');
	case 'ice': return _('comma separated STUN servers');
	case 'cert': return _('certificate parameter from the bridge line (cert=...)');
	case 'iat': return _('intensity anti-traffic analysis: 0 or 1 or 2');
	case 'extra': return _('additional parameters, for example ampcache=... front=...');
	}
	return '';
}

/* разбор готовой строки моста в отдельные параметры */
function parseLine(line, type) {
	var out = { addr: '', fingerprint: '', url: '', ice: '', cert: '', iat: '', extra: '' };
	var s = (line || '').replace(/^Bridge\s+/i, '').trim();
	if (!s) return out;

	var toks = s.split(/\s+/);
	if (TYPES[toks[0]]) {
		type = toks[0];
		toks.shift();
	}
	out.addr = toks.shift() || '';
	var unknown = [];
	toks.forEach(function(t) {
		var kv = t.split('=');
		if (kv.length === 2) {
			if (kv[0] === 'url') out.url = kv[1];
			else if (kv[0] === 'ice') out.ice = kv[1];
			else if (kv[0] === 'cert') out.cert = kv[1];
			else if (kv[0] === 'iat-mode') out.iat = kv[1];
			else if (kv[0] !== 'fingerprint') unknown.push(t);
		} else if (/^[0-9a-fA-F]{40}$/.test(t) && !out.fingerprint) {
			out.fingerprint = t;
		} else {
			unknown.push(t);
		}
	});
	out.extra = unknown.join(' ');
	return out;
}

function textField(id, label, value, hint, onChange) {
	var inp = E('input', { 'type': 'text', 'id': id, 'class': 'cbi-input-text', 'value': value || '' });
	inp.addEventListener('change', function() { onChange(inp.value); });
	return E('div', { 'class': 'tor-field' }, [
		E('label', { 'for': id }, [ label ]),
		inp,
		hint ? E('div', { 'class': 'tor-field-hint' }, [ hint ]) : ''
	]);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function() {
		return Promise.all([
			callUciGet('tor_pro'),
			callStatus().catch(function() { return {}; }),
			callBridgeMon().catch(function() { return {}; })
		]);
	},

	refreshData: function() {
		return Promise.all([
			callUciGet('tor_pro'),
			callStatus().catch(function() { return {}; }),
			callBridgeMon().catch(function() { return {}; })
		]);
	},

	render: function(data) {
		var self = this;
		var st = data[1] || {};
		var mon = data[2] || {};

		var wrap = E('div', { 'class': 'tor-wrap' });
		var tableBox = E('div', {});

		/* ---------- панель мониторинга (перенесена с «Доступность мостов») ---------- */
		var pro = (data[0] && data[0].settings) || {};

		var enMon = E('input', { 'type': 'checkbox', 'id': 'tor_bmon_en', 'class': 'cbi-input-checkbox' });
		enMon.checked = (pro.bridge_mon_enabled !== '0');
		enMon.addEventListener('change', function() {
			callUciSet('tor_pro', 'settings', { bridge_mon_enabled: enMon.checked ? '1' : '0' })
				.then(function() { return callUciCommit('tor_pro'); });
		});

		var intervalSel = E('select', { 'class': 'cbi-input-select' });
		[30, 60, 180, 300, 600, 900].forEach(function(v) {
			var o = E('option', { 'value': String(v) }, [ String(v) ]);
			if (String(v) === String(pro.bridge_mon_interval || '300')) o.selected = 'selected';
			intervalSel.appendChild(o);
		});
		intervalSel.addEventListener('change', function() {
			callUciSet('tor_pro', 'settings', { bridge_mon_interval: intervalSel.value })
				.then(function() { return callUciCommit('tor_pro'); });
		});

		var nowBtn = E('button', {
			'class': 'cbi-button cbi-button-apply',
			'click': function(ev) {
				ev.preventDefault();
				ev.target.disabled = true;
				callMonNow().then(function() {
					ui.addNotification(null, E('p', [ _('Check started, results in a few seconds') ]), 'info');
					window.setTimeout(function() {
						if (tableBox.isConnected)
							self.refreshTable(tableBox);
					}, 8000);
				}).finally(function() { ev.target.disabled = false; });
			}
		}, [ _('Check now') ]);

		var applyBtn = E('button', {
			'class': 'cbi-button cbi-button-action important',
			'click': function(ev) {
				ev.preventDefault();
				applyBtn.disabled = true;
				callUciCommit('tor_pro').then(function() {
					return callApply();
				}).then(function() {
					ui.addNotification(null, E('p', [ _('Tor bridges applied and tor restarted') ]), 'success');
					return self.refreshData();
				}).then(function(d2) {
					self.redraw(tableBox, d2);
				}).catch(function(e) {
					ui.addNotification(null, E('p', [ _('Failed to apply bridges: %s').format(e.message) ]), 'error');
				}).finally(function() { applyBtn.disabled = false; });
			}
		}, [ _('Apply bridges') ]);

		wrap.appendChild(E('div', { 'class': 'tor-toolbar' }, [
			E('span', { 'class': 'tor-badge ' + (mon.watcher ? 'tor-badge-ok' : 'tor-badge-warn') },
				[ mon.watcher ? _('monitoring is running (background, ~0% CPU)') : _('monitoring is stopped') ]),
			E('label', { 'class': 'tor-toolbar-item', 'for': 'tor_bmon_en' }, [
				enMon, E('span', {}, [ _('Background monitoring') ]) ]),
			E('label', { 'class': 'tor-toolbar-item' }, [
				E('span', {}, [ _('Check interval') ]), intervalSel,
				E('span', { 'class': 'tor-dim' }, [ _('seconds between checks') ]) ]),
			nowBtn,
			E('span', { 'style': 'flex:1' }),
			applyBtn
		]));

		/* ---------- компактный список мостов ---------- */
		wrap.appendChild(E('h3', { 'class': 'tor-card-title', 'style': 'margin:10px 0 6px' },
			[ _('Bridges') ]));

		var addBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'style': 'margin-left:12px',
			'click': function(ev) {
				ev.preventDefault();
				/* окно нового моста открывается мгновенно, без RPC:
				   секция создаётся только по «Сохранить и применить» */
				self.newModal();
			}
		}, [ _('Add bridge') ]);

		wrap.appendChild(E('div', { 'class': 'tor-toolbar' }, [
			E('span', { 'class': 'tor-dim' }, [
				_('The Use checkbox controls whether the bridge is written to the Tor configuration file %s when you apply. Bridges that are already present in /etc/tor/torrc manually are used by Tor regardless of this list.').format('/etc/tor/torrc_bridges')
			]),
			addBtn
		]));

		wrap.appendChild(E('div', { 'style': 'margin-top:8px' }, [ tableBox ]));

		this.tableBox = tableBox;
		this.redraw(tableBox, data);

		/* автообновление статуса и мониторинга раз в N секунд */
		var auto = parseInt(pro.refresh, 10);
		if (!(auto > 2)) auto = 5;
		this.pollTimer = window.setInterval(function() {
			if (!tableBox.isConnected)
				return;
			self.refreshTable(tableBox);
		}, auto * 1000);

		return E('div', {}, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/tor/tor2.css') }),
			wrap
		]);
	},

	unload: function() {
		if (this.pollTimer) { window.clearInterval(this.pollTimer); this.pollTimer = null; }
	},

	/* перерисовка всей таблицы по свежим данным */
	redraw: function(box, data) {
		var self = this;
		dom.content(box, this.buildTable(data));
	},

	refreshTable: function(box) {
		var self = this;
		return this.refreshData().then(function(d2) { self.redraw(box, d2); });
	},

	/* таблица мостов */
	buildTable: function(data) {
		var self = this;
		var values = data[0] || {};
		var st = data[1] || {};
		var mon = data[2] || {};
		var guard = (st.tor || {}).guard || '';

		/* статистика использования из state-файла tor: по fingerprint или по host */
		var torByFp = {}, torByHost = {};
		(st.bridges || []).forEach(function(tb) {
			if (tb.fingerprint) torByFp[tb.fingerprint] = tb;
			var host = (tb.addr || '').split(':')[0];
			if (host) torByHost[host] = tb;
		});

		/* мониторинг по имени секции */
		var monBySec = {};
		(mon.bridges || []).forEach(function(mb) {
			monBySec[mb.sec] = mb;
		});

		var sids = Object.keys(values).filter(function(k) {
			return values[k] && values[k]['.type'] === 'bridge';
		});

		var rows = sids.map(function(sid) {
			var b = values[sid];
			var type = TYPES[b.type] ? b.type : 'vanilla';
			var parsed = parseLine(b.line, type);
			var addr = b.addr || parsed.addr;
			var fp = b.fingerprint || parsed.fingerprint;
			var host = (addr || '').split(':')[0];

			var tor = torByFp[fp] || torByHost[host] || null;
			var m = monBySec[sid] || null;

			/* порядок сортировки: используемый сейчас → используемый → недоступный → прочие */
			var now = false, rank = 4;
			if (guard && addr && (guard === addr || guard.split(':')[0] === host)) {
				now = true; rank = 0;
			}
			else if (tor && (tor.use_successes || 0) > 0) rank = 1;
			else if (tor && (tor.use_attempts || 0) > 0) rank = 2;
			else if (m && m.totc > 0 && !m.ok) rank = 3;

			return { sid: sid, b: b, type: type, parsed: parsed, addr: addr, fp: fp,
				host: host, tor: tor, m: m, now: now, rank: rank };
		}).sort(function(a, b) {
			if (a.rank !== b.rank) return a.rank - b.rank;
			return String(a.addr).localeCompare(String(b.addr));
		});

		var thead = E('thead', {}, [ E('tr', {}, [
			E('th', {}, [ _('Use') ]),
			E('th', {}, [ _('Type') ]),
			E('th', {}, [ _('Address') ]),
			E('th', {}, [ _('Statistics') ]),
			E('th', {}, [ _('Availability') ]),
			E('th', { 'class': 'tor-num' }, [ '' ])
		]) ]);

		var tbody = E('tbody', {}, rows.map(function(r) {
			return self.buildRow(r, guard);
		}));

		if (!rows.length)
			return E('div', { 'class': 'tor-empty' }, [ _('No bridges configured') ]);

		return E('table', { 'class': 'tor-table tor-bridges' }, [ thead, tbody ]);
	},

	buildRow: function(r, guard) {
		var self = this;
		var b = r.b, sid = r.sid;

		/* галочка «Использовать» */
		var enCb = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		enCb.checked = (b.enabled === '1');
		enCb.addEventListener('change', function() {
			callUciSet('tor_pro', sid, { enabled: enCb.checked ? '1' : '0' })
				.then(function() { return callUciCommit('tor_pro'); });
		});

		/* статус использования tor'ом */
		var statBadge, statSub = '';
		if (r.now) {
			statBadge = E('span', { 'class': 'tor-badge tor-badge-ok' }, [ _('used right now') ]);
		} else if (r.tor) {
			if (r.tor.listed === false) {
				statBadge = E('span', { 'class': 'tor-badge tor-badge-warn' }, [ _('not in consensus') ]);
			} else if ((r.tor.use_successes || 0) > 0) {
				statBadge = E('span', { 'class': 'tor-badge tor-badge-ok' }, [ _('alive') ]);
			} else if ((r.tor.use_attempts || 0) > 0) {
				statBadge = E('span', { 'class': 'tor-badge tor-badge-bad' }, [ _('unreachable') ]);
			} else {
				statBadge = E('span', { 'class': 'tor-badge tor-badge-muted' }, [ _('not used yet') ]);
			}
			var parts = [];
			if (r.tor.use_attempts)
				parts.push(r.tor.use_successes + '/' + r.tor.use_attempts);
			if (r.tor.circ_attempts)
				parts.push(_('circuits') + ': ' + r.tor.circ_successes + '/' + r.tor.circ_attempts);
			if (r.tor.confirmed)
				parts.push(_('confirmed') + ': ' + r.tor.confirmed);
			statSub = parts.join(' · ');
		} else {
			statBadge = E('span', { 'class': 'tor-badge tor-badge-muted' }, [ _('not used yet') ]);
		}

		/* доступность из фонового мониторинга */
		var reachBadge, reachSub = '—';
		if (r.m && r.m.totc > 0) {
			if (r.m.ok === true) {
				reachBadge = E('span', { 'class': 'tor-badge tor-badge-ok' }, [ _('reachable') ]);
				reachSub = (r.m.ms > 0 ? r.m.ms + ' ms · ' : '') +
					new Date(r.m.ts * 1000).toLocaleTimeString();
			} else {
				reachBadge = E('span', { 'class': 'tor-badge tor-badge-warn' }, [ _('unreachable') ]);
				reachSub = r.m.okc + ' / ' + r.m.totc;
			}
		} else {
			reachBadge = E('span', { 'class': 'tor-badge tor-badge-muted' }, [ _('not checked yet') ]);
		}

		var testLive = E('span', { 'class': 'tor-list-item-live' }, [ '' ]);

		/* кнопка проверки */
		var testBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function(ev) {
				ev.preventDefault();
				ev.target.disabled = true;
				testLive.textContent = _('Testing...');
				var url = r.b.url || r.parsed.url || '';
				callTest(r.addr, url).then(function(res) {
					testLive.textContent = '';
					if (res && res.status === 'ok') {
						testLive.appendChild(E('span', { 'class': 'tor-badge tor-badge-ok' },
							[ _('reachable') + (res.ms > 0 ? ' ' + res.ms + ' ms' : '') ]));
					} else {
						testLive.appendChild(E('span', { 'class': 'tor-badge tor-badge-warn' }, [ _('unreachable') ]));
					}
				}).catch(function() {
					testLive.textContent = '';
				}).finally(function() {
					ev.target.disabled = false;
				});
			}
		}, [ _('Test') ]);

		/* редактирование в модальном окне */
		var editBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function(ev) {
				ev.preventDefault();
				self.editModal(r);
			}
		}, [ _('Edit') ]);

		/* удаление */
		var delBtn = E('button', {
			'class': 'cbi-button cbi-button-remove',
			'click': function(ev) {
				ev.preventDefault();
				callUciDelete('tor_pro', sid).then(function() {
					return callUciCommit('tor_pro');
				}).then(function() {
					return self.refreshTable(self.tableBox);
				});
			}
		}, [ '×' ]);

		return E('tr', { 'class': r.now ? 'tor-row-now' : '' }, [
			E('td', { 'class': 'tor-cell-cb' }, [ enCb ]),
			E('td', {}, [
				E('span', { 'class': 'tor-badge tor-badge-info' },
					[ TYPES[r.type].title ])
			]),
			E('td', { 'class': 'tor-cell-addr' }, [
				E('div', { 'class': 'tor-mono' }, [ r.addr || _('not configured') ]),
				b.comment ? E('div', { 'class': 'tor-dim', 'style': 'font-size:11px' }, [ b.comment ]) : ''
			]),
			E('td', {}, [ statBadge, statSub ? E('div', { 'class': 'tor-dim', 'style': 'font-size:11px' }, [ statSub ]) : '' ]),
			E('td', {}, [ reachBadge, testLive, E('div', { 'class': 'tor-dim', 'style': 'font-size:11px' }, [ reachSub ]) ]),
			E('td', { 'class': 'tor-num tor-cell-actions' }, [ testBtn, editBtn, delBtn ])
		]);
	},

	/* модальное окно редактирования существующего моста */
	editModal: function(r) {
		var self = this;
		var b = r.b, sid = r.sid, type = r.type;

		function renderBody() {
			var body = E('div', { 'class': 'tor-fields' });

			/* тип моста — смена перерисовывает окно на месте, не закрывая его */
			var typeSel = E('select', { 'id': 'tor_ed_type', 'class': 'cbi-input-select' },
				Object.keys(TYPES).map(function(k) {
					return E('option', { 'value': k, 'selected': k === type ? 'selected' : null }, [ TYPES[k].title ]);
				}));
			typeSel.addEventListener('change', function() {
				var nt = typeSel.value;
				var vals = { type: nt };
				TYPES[nt].fields.forEach(function(f) { vals[f] = ''; });
				callUciSet('tor_pro', sid, vals).then(function() {
					/* окно не закрывается: обновляем данные и перерисовываем его */
					r.b = Object.assign({}, r.b, vals);
					r.addr = '';
					r.fp = '';
					type = nt;
					ui.showModal(_('Bridge'), [
						E('h3', { 'class': 'tor-card-title', 'style': 'margin-bottom:10px' },
							[ TYPES[type].title + ' — ' + (r.addr || _('not configured')) ]),
						renderBody(),
						footer()
					]);
					self.refreshTable(self.tableBox);
				});
			});
			body.appendChild(E('div', { 'class': 'tor-field' }, [
				E('label', { 'for': 'tor_ed_type' }, [ _('Type') ]), typeSel
			]));

			/* поля выбранного типа (addr читаем из окна — его правка ещё не уходила в UCI) */
			function curAddr() {
				var a = document.getElementById('tor_ed_addr');
				return a ? a.value.trim() : r.addr;
			}
			TYPES[type].fields.forEach(function(f) {
				var val = (f === 'addr' ? r.addr : f === 'fingerprint' ? r.fp
					: f === 'cert' ? (b.cert || '') : f === 'iat' ? (b.iat || '') : f === 'extra'
						? (b.extra || '') : f === 'url' ? (b.url || '') : (b.ice || ''));
				body.appendChild(textField('tor_ed_' + f, fieldLabel(f), val, fieldHint(f), function(v) {
					var vals = {};
					vals[f] = v;
					if (f === 'addr') r.addr = v;
					callUciSet('tor_pro', sid, vals);
				}));
			});

			body.appendChild(textField('tor_ed_comment', fieldLabel('comment'), b.comment, '', function(v) {
				callUciSet('tor_pro', sid, { comment: v });
			}));

			/* статистика использования */
			var statsTxt = '—';
			if (r.tor) {
				var sparts = [];
				if (r.tor.use_attempts)
					sparts.push(_('connections') + ': ' + r.tor.use_successes + '/' + r.tor.use_attempts);
				if (r.tor.circ_attempts)
					sparts.push(_('circuits') + ': ' + r.tor.circ_successes + '/' + r.tor.circ_attempts);
				if (r.tor.confirmed)
					sparts.push(_('confirmed') + ': ' + r.tor.confirmed);
				if (r.tor.listed === false)
					sparts.push(_('not in consensus'));
				statsTxt = sparts.join(' · ') || _('not used yet');
			}
			body.appendChild(E('div', { 'class': 'tor-field' }, [
				E('label', {}, [ _('Statistics') ]),
				E('div', { 'class': 'tor-field-hint' }, [ statsTxt ])
			]));

			/* проверка */
			var modalLive = E('span', {}, [ '' ]);
			body.appendChild(E('div', { 'class': 'tor-field' }, [
				E('label', {}, [ _('Availability') ]),
				modalLive,
				E('span', { 'style': 'margin-left:8px' },
					[ E('button', {
						'class': 'cbi-button cbi-button-apply',
						'click': function(ev) {
							ev.preventDefault();
							ev.target.disabled = true;
							modalLive.textContent = _('Testing...');
							callTest(curAddr(), r.b.url || r.parsed.url || '').then(function(res) {
								modalLive.textContent = '';
								modalLive.appendChild(E('span', { 'class': 'tor-badge tor-badge-' +
									(res && res.status === 'ok' ? 'ok' : 'warn') },
									[ (res && res.status === 'ok') ? _('reachable') + (res.ms > 0 ? ' ' + res.ms + ' ms' : '') : _('unreachable') ]));
							}).catch(function() {
								modalLive.textContent = '';
							}).finally(function() {
								ev.target.disabled = false;
							});
						}
					}, [ _('Test') ]) ])
			]));

			return body;
		}

		function footer() {
			return E('div', { 'style': 'margin-top:14px; text-align:right' }, [
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': function(ev) { ev.preventDefault(); ui.hideModal(); }
				}, [ _('Cancel') ]),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'style': 'margin-left:8px',
					'click': function(ev) {
						ev.preventDefault();
						ui.hideModal();
						callUciCommit('tor_pro').then(function() {
							return self.refreshTable(self.tableBox);
						});
					}
				}, [ _('Save & Apply') ])
			]);
		}

		ui.showModal(_('Bridge'), [
			E('h3', { 'class': 'tor-card-title', 'style': 'margin-bottom:10px' },
				[ TYPES[type].title + ' — ' + (r.addr || _('not configured')) ]),
			renderBody(),
			footer()
		]);
	},

	/* окно нового моста: открывается мгновенно, без RPC; секция создаётся
	   в UCI только по «Сохранить и применить»; смена типа не закрывает окно */
	newModal: function() {
		var self = this;
		var nb = { type: 'obfs4', addr: '', fingerprint: '', cert: '', iat: '', url: '', ice: '', extra: '', comment: '' };

		/* напечатанное забираем в nb даже без blur */
		function harvest() {
			TYPES[nb.type].fields.concat([ 'comment' ]).forEach(function(f) {
				var el = document.getElementById('tor_new_' + f);
				if (el) nb[f] = el.value;
			});
		}

		function save() {
			harvest();
			var vals = { enabled: '1', type: nb.type };
			TYPES[nb.type].fields.concat([ 'comment' ]).forEach(function(f) {
				vals[f] = (nb[f] || '').trim();
			});
			if (!vals.addr) {
				ui.addNotification(null, E('p', [ _('Address is required') ]), 'error');
				return;
			}
			callUciAdd('tor_pro', 'bridge').then(function(sid) {
				return callUciSet('tor_pro', sid, vals);
			}).then(function() {
				return callUciCommit('tor_pro');
			}).then(function() {
				ui.hideModal();
				return self.refreshTable(self.tableBox);
			}).catch(function(e) {
				ui.addNotification(null, E('p', [ _('Failed to add bridge: %s').format(e.message) ]), 'error');
			});
		}

		function show() {
			var body = E('div', { 'class': 'tor-fields' });

			var typeSel = E('select', { 'id': 'tor_new_type', 'class': 'cbi-input-select' },
				Object.keys(TYPES).map(function(k) {
					return E('option', { 'value': k, 'selected': k === nb.type ? 'selected' : null }, [ TYPES[k].title ]);
				}));
			typeSel.addEventListener('change', function() {
				/* перерисовка на месте: окно остаётся открытым */
				harvest();
				nb.type = typeSel.value;
				show();
			});
			body.appendChild(E('div', { 'class': 'tor-field' }, [
				E('label', { 'for': 'tor_new_type' }, [ _('Type') ]), typeSel
			]));

			TYPES[nb.type].fields.forEach(function(f) {
				body.appendChild(textField('tor_new_' + f, fieldLabel(f), nb[f], fieldHint(f),
					function(v) { nb[f] = v; }));
			});

			body.appendChild(textField('tor_new_comment', fieldLabel('comment'), nb.comment, '',
				function(v) { nb.comment = v; }));

			ui.showModal(_('Bridge'), [
				E('h3', { 'class': 'tor-card-title', 'style': 'margin-bottom:10px' },
					[ TYPES[nb.type].title + ' — ' + _('new bridge') ]),
				body,
				E('div', { 'style': 'margin-top:14px; text-align:right' }, [
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'click': function(ev) { ev.preventDefault(); ui.hideModal(); }
					}, [ _('Cancel') ]),
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'style': 'margin-left:8px',
						'click': function(ev) { ev.preventDefault(); save(); }
					}, [ _('Save & Apply') ])
				])
			]);
		}

		show();
	}
});
