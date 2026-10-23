'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require dom';

var callPackages = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'packages' });
var callBridgeTypes = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'bridge-types' });
var callInstall = rpc.declare({ nobatch: true, object: 'tor-pro-rpc', method: 'install-package' });

/* пакеты, необходимые для работы */
var PKGS = [
	{ g: 'core', n: 'tor', t: 'Tor daemon', d: 'основной демон tor' },
	{ g: 'routing', n: 'firewall4', t: 'firewall4', d: 'ipset и правила nft — маршрутизация трафика через tor' },
	{ g: 'routing', n: 'nftables-json', t: 'nftables', d: 'счётчики трафика для мониторинга' }
];

/* типы мостов и пакеты, которые им нужны */
var BRIDGE_TYPES = [
	{ id: 'vanilla', t: 'vanilla', d: 'обычный мост, дополнительных пакетов не нужно' },
	{ id: 'obfs4', t: 'obfs4', d: 'мост с маскировкой, нужен пакет obfs4proxy' },
	{ id: 'snowflake', t: 'snowflake', d: 'мост через WebRTC, нужен пакет snowflake-client' },
	{ id: 'meek-azure', t: 'meek-azure', d: 'мост через облако, поддерживается самим tor' }
];

/* заголовки групп пакетов (строки в _() — чтобы их видел i18n-scan) */
function groupTitle(g) {
	switch (g) {
	case 'core': return _('Core packages');
	case 'routing': return _('Routing packages');
	case 'bridges': return _('Bridge packages');
	}
	return g;
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
		return Promise.all([
			callPackages().catch(function() { return {}; }),
			callBridgeTypes().catch(function() { return {}; }),
			uci.load('tor_pro'), uci.load('tor')
		]);
	},

	render: function(data) {
		var self = this;
		var pkgs = data[0] || {};
		var btypes = data[1] || {};
		var wrap = E('div', { 'class': 'tor-wrap' });

		/* ---------- блок «Пакеты» ---------- */
		var cPkg = card(_('Packages'));
		var pkgBox = E('div', {});
		cPkg.body.appendChild(pkgBox);
		wrap.appendChild(cPkg.box);

		var installBtn = function(pkg) {
			return E('button', {
				'class': 'cbi-button cbi-button-action important',
				'click': function(ev) {
					ev.preventDefault();
					ev.target.disabled = true;
					callInstall(pkg).then(function(res) {
						if (res && res.status === 'ok') {
							ui.addNotification(null, E('p', [ _('Package %s installed').format(pkg) ]), 'info');
							return Promise.all([ callPackages(), callBridgeTypes() ]).then(function(r) {
								self.renderPackages(pkgBox, r[0], r[1]);
							});
						}
						ui.addNotification(null, E('p', [ _('Failed to install %s: %s').format(pkg,
							(res && res.message) || _('unknown error')) ]), 'error');
					}).catch(function(e) {
						ui.addNotification(null, E('p', [ _('Failed to install %s: %s').format(pkg, e.message) ]), 'error');
					}).finally(function() {
						ev.target.disabled = false;
					});
				}
			}, [ _('Install') ]);
		};

		var pkgRow = function(name, desc, installed, version, action) {
			return E('div', { 'class': 'tor-pkg' }, [
				E('div', { 'class': 'tor-pkg-name' }, [ name ]),
				E('div', { 'class': 'tor-pkg-desc' }, [ desc ]),
				E('span', { 'class': 'tor-badge tor-badge-' + (installed ? 'ok' : 'warn') },
					[ installed ? _('installed') : _('not installed') ]),
				installed ? E('span', { 'class': 'tor-pkg-ver' }, [ version || '' ]) : (action || '')
			]);
		};

		var groups = {};
		['core', 'routing', 'bridges'].forEach(function(g) { groups[g] = []; });
		PKGS.forEach(function(p) { (groups[p.g] = groups[p.g] || []).push(p); });

		Object.keys(groups).forEach(function(g) {
			if (!groups[g].length) return;
			var rows = groups[g].map(function(p) {
				var st = pkgs[p.n] || {};
				return pkgRow(p.n, p.d, !!st.installed, st.version,
					!!st.installed ? null : installBtn(p.n));
			});
			pkgBox.appendChild(E('div', { 'class': 'tor-pkg-group' }, [
				E('div', { 'class': 'tor-pkg-group-title' }, [ groupTitle(g) ]),
				E('div', { 'class': 'tor-list' }, rows)
			]));
		});

		/* типы мостов */
		var bridgeRows = BRIDGE_TYPES.map(function(b) {
			var st = btypes[b.id] || {};
			var pkg = st.package;
			if (!pkg) {
				return pkgRow(b.t, b.d, true, _('not required'), null);
			}
			return pkgRow(pkg, b.d, !!st.installed, st.installed ? '' : '',
				st.installed ? null : installBtn(pkg));
		});
		pkgBox.appendChild(E('div', { 'class': 'tor-pkg-group' }, [
			E('div', { 'class': 'tor-pkg-group-title' }, [ _('Bridge packages') ]),
			E('div', { 'class': 'tor-list' }, bridgeRows)
		]));

		this.renderPackages = function(box, list, types) {
			var items = box.querySelectorAll('.tor-pkg');
			items.forEach(function(el) {
				var nameEl = el.querySelector('.tor-pkg-name');
				if (!nameEl) return;
				var name = nameEl.textContent;
				var st = (list && list[name]) || (types && types[name]) || {};
				var badge = el.querySelector('.tor-badge');
				if (badge && st.installed !== undefined) {
					badge.textContent = st.installed ? _('installed') : _('not installed');
					badge.className = 'tor-badge tor-badge-' + (st.installed ? 'ok' : 'warn');
				}
			});
		};

		/* ---------- форма конфигурации tor ---------- */
		var mTor = new form.Map('tor', _('Tor onion router'),
			_('For further information <a %s>check the documentation</a>')
				.format('href="https://openwrt.org/docs/guide-user/services/tor/client" target="_blank" rel="noreferrer"'));
		var sTor = mTor.section(form.NamedSection, 'conf', 'tor');

		sTor.option(form.DynamicList, 'tail_include', _('Include configs')).datatype = 'list(string)';

		var oCfg = sTor.option(form.FileUpload, '_custom_config', _('Custom config'));
		oCfg.default = '/etc/tor/torrc_custom';
		oCfg.root_directory = '/etc/tor/';
		oCfg.optional = true;
		oCfg.write = function(section_id, formvalue) {
			var tail_include = uci.get('tor', section_id, 'tail_include');
			if (!tail_include.includes(formvalue)) {
				tail_include.push(formvalue);
				return uci.set('tor', section_id, 'tail_include', tail_include);
			}
		};

		return mTor.render().then(function(rendered) {
			wrap.appendChild(E('div', { 'class': 'tor-card' }, [
				E('div', { 'class': 'tor-card-head' }, [
					E('h3', { 'class': 'tor-card-title' }, [ _('Tor onion router') ])
				]),
				rendered
			]));

			return E('div', {}, [
				E('link', { 'rel': 'stylesheet', 'href': L.resource('view/tor/tor2.css') }),
				wrap
			]);
		});
	}
});
