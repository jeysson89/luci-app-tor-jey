'use strict';
'require view';
'require rpc';
'require ui';
'require dom';
'require uci';

var callDevices = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'devices' });
var callApply = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'apply-routing' });

var callUciGet = rpc.declare({ nobatch: true, object: 'uci', method: 'get', params: [ 'config' ], expect: { values: {} } });
var callUciSet = rpc.declare({ nobatch: true, object: 'uci', method: 'set', params: [ 'config', 'section', 'values' ] });
var callUciAdd = rpc.declare({ nobatch: true, object: 'uci', method: 'add',
	params: [ 'config', 'type', 'name', 'values' ], expect: { section: '' } });
var callUciDelete = rpc.declare({ nobatch: true, object: 'uci', method: 'delete', params: [ 'config', 'section', 'options' ] });
var callUciCommit = rpc.declare({ nobatch: true, object: 'uci', method: 'commit', params: [ 'config' ] });

function card(title, right) {
	var head = E('div', { 'class': 'tor-card-head' }, [ E('h3', { 'class': 'tor-card-title' }, [ title ]) ]);
	if (right) head.appendChild(right);
	var body = E('div', {});
	return { box: E('div', { 'class': 'tor-card' }, [ head, body ]), body: body };
}

function switchBox(id, checked) {
	var el = E('input', { 'type': 'checkbox', 'id': id, 'class': 'cbi-input-checkbox' });
	if (checked) el.setAttribute('checked', 'checked');
	el.checked = !!checked;
	return el;
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function() {
		return Promise.all([ callUciGet('tor_pro'), callDevices() ]);
	},

	render: function(data) {
		var self = this;
		var values = data[0] || {};
		var devs = (data[1] && data[1].devices) || [];
		var clients = Object.keys(values).filter(function(k) {
			return values[k] && values[k]['.type'] === 'client';
		});

		var wrap = E('div', { 'class': 'tor-wrap' });

		/* ---------- блок 1: клиенты за tor ---------- */
		var addBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function(ev) {
				ev.preventDefault();
				callUciAdd('tor_pro', 'client').then(function(sid) {
					return callUciSet('tor_pro', sid, { ip: '', name: '', mac: '', enabled: '1' });
				}).then(function() {
					self.reload();
				});
			}
		}, [ _('Add') ]);

		var cClients = card(_('Routed clients'), addBtn);
		var rows = [];

		if (!clients.length) {
			rows.push(E('tr', {}, [ E('td', { 'colspan': '6', 'class': 'tor-empty' },
				[ _('No clients') ]) ]));
		}

		clients.forEach(function(sid) {
			var c = values[sid];

			var ipIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': c.ip || '' });
			ipIn.addEventListener('change', function() {
				callUciSet('tor_pro', sid, { ip: ipIn.value });
			});

			var nameIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': c.name || '' });
			nameIn.addEventListener('change', function() {
				callUciSet('tor_pro', sid, { name: nameIn.value });
			});

			var macIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': c.mac || '' });
			macIn.addEventListener('change', function() {
				callUciSet('tor_pro', sid, { mac: macIn.value });
			});

			var enCb = switchBox('tor_c_' + sid, c.enabled === '1');
			enCb.addEventListener('change', function() {
				callUciSet('tor_pro', sid, { enabled: enCb.checked ? '1' : '0' });
			});

			var ksCb = switchBox('tor_k_' + sid, c.killswitch === '1');
			ksCb.addEventListener('change', function() {
				callUciSet('tor_pro', sid, { killswitch: ksCb.checked ? '1' : '0' });
			});

			var delBtn = E('button', {
				'class': 'cbi-button cbi-button-remove',
				'click': function(ev) {
					ev.preventDefault();
					callUciDelete('tor_pro', sid).then(function() {
						self.reload();
					});
				}
			}, [ _('Delete') ]);

			rows.push(E('tr', {}, [
				E('td', { 'style': 'width:190px' }, [ ipIn ]),
				E('td', { 'style': 'width:190px' }, [ nameIn ]),
				E('td', { 'style': 'width:170px' }, [ macIn ]),
				E('td', { 'style': 'width:96px;text-align:center;vertical-align:middle' }, [ enCb ]),
				E('td', { 'style': 'width:96px;text-align:center;vertical-align:middle' }, [ ksCb ]),
				E('td', { 'class': 'tor-num' }, [ delBtn ])
			]));
		});

		dom.content(cClients.body, E('table', { 'class': 'tor-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('IP address or subnet') ]),
				E('th', {}, [ _('Name') ]),
				E('th', {}, [ _('MAC address') ]),
				E('th', { 'class': 'tor-num', 'style': 'width:96px' }, [ _('Through Tor') ]),
				E('th', { 'class': 'tor-num', 'style': 'width:96px' }, [ _('Killswitch') ]),
				E('th', { 'class': 'tor-num' }, [ '' ])
			]) ]),
			E('tbody', {}, rows)
		]));
		wrap.appendChild(cClients.box);

		/* ---------- блок 2: обнаруженные устройства ---------- */
		var cDev = card(_('Detected devices'));
		var drows = [];

		if (!devs.length) {
			drows.push(E('tr', {}, [ E('td', { 'colspan': '4', 'class': 'tor-empty' },
				[ _('No devices found') ]) ]));
		}

		devs.forEach(function(d) {
			var btn = E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': function(ev) {
					ev.preventDefault();
					callUciAdd('tor_pro', 'client').then(function(sid) {
						return callUciSet('tor_pro', sid, {
							ip: d.ip, name: d.name || '', mac: d.mac || '', enabled: '1'
						});
					}).then(function() {
						ui.addNotification(null, E('p', [ _('Device %s added to the list.').format(d.ip) ]), 'info');
						self.reload();
					});
				}
			}, [ d.in_tor ? _('Add again') : _('Route through Tor') ]);

			drows.push(E('tr', {}, [
				E('td', {}, [ d.name || E('span', { 'class': 'tor-dim' }, [ d.mac || '—' ]) ]),
				E('td', { 'class': 'tor-mono' }, [ d.ip ]),
				E('td', { 'class': 'tor-mono tor-dim' }, [ d.mac || '—' ]),
				E('td', { 'class': 'tor-num' }, [
					E('span', { 'class': 'tor-badge tor-badge-' + (d.in_tor ? 'ok' : 'muted') },
						[ d.in_tor ? _('yes') : _('no') ])
				]),
				E('td', { 'class': 'tor-num' }, [ btn ])
			]));
		});

		dom.content(cDev.body, E('table', { 'class': 'tor-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Device') ]),
				E('th', {}, [ _('IP address') ]),
				E('th', {}, [ _('MAC') ]),
				E('th', { 'class': 'tor-num' }, [ _('Through Tor') ]),
				E('th', { 'class': 'tor-num' }, [ '' ])
			]) ]),
			E('tbody', {}, drows)
		]));
		wrap.appendChild(cDev.box);

		/* ---------- блок 3: применение ---------- */
		var saveBtn = E('button', {
			'class': 'cbi-button cbi-button-action important',
			'click': function(ev) {
				ev.preventDefault();
				saveBtn.disabled = true;
				callUciCommit('tor_pro').then(function() {
					return callApply();
				}).then(function() {
					ui.addNotification(null, E('p', [ _('Routing applied, firewall reloaded.') ]), 'info');
				}).catch(function(e) {
					ui.addNotification(null, E('p', [ _('Failed to apply routing: %s').format(e.message) ]), 'error');
				}).finally(function() {
					saveBtn.disabled = false;
				});
			}
		}, [ _('Save & Apply') ]);

		var cApply = card(_('Apply'));
		dom.content(cApply.body, [
			E('div', { 'class': 'tor-hint' }, [
				E('div', { 'style': 'margin-bottom:6px' },
					[ _('Choose the devices or subnets whose traffic should go through Tor. The list is written to the %s set of the firewall configuration.').format('tor_clients') ]),
				E('div', {}, [ E('code', {}, [ '192.168.200.10' ]), ' — ',
					E('code', {}, [ '192.168.199.0/24' ]), ' — ',
					_('both addresses and subnets are supported') ])
			]),
			E('div', {}, [ saveBtn ]),
			E('div', { 'class': 'tor-hint', 'style': 'margin-top:12px' },
				[ _('Killswitch blocks any traffic that would bypass Tor for the selected clients, so nothing leaks to the internet if Tor is down.') ])
		]);
		wrap.appendChild(cApply.box);

		this.reload = function() {
			return callUciGet('tor_pro').then(function() {
				window.location.reload();
			});
		};

		return E('div', {}, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/tor/tor2.css') }),
			wrap
		]);
	}
});
