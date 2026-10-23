# luci-app-tor-jey

A fork of [luci-app-tor](https://github.com/openwrt/luci/tree/master/applications/luci-app-tor)
for OpenWrt 25.12, extended with a bridge-monitoring and management UI.
Built and tested on a Bazis AX3000WM (MediaTek MT7981, `mediatek/filogic`).

## Features

- **Status** — daemon state, uptime, bootstrap, guard, traffic graph, killswitch-aware routing.
- **Bridges** (single tab, r8+): compact list of all configured bridges with
  "used right now" badge for the active guard, availability, latency (ms) and
  test/edit/remove actions; editing in a popup modal; background bridge
  monitoring (observer, interval, "check now", "apply bridges").
- **Routing** — Tor clients (IP/subnet), killswitch, DHCP device discovery.
- **Monitoring** — per-device traffic and destinations through Tor.
- **Log** — live Tor log with filter/follow.
- **Settings** — package install panel + Tor configuration form.

All views use their own `setInterval` timers instead of LuCI's global `poll`
(which freezes in background tabs), and refresh instantly on tab visibility.

## Bridges live in `/etc/tor/torrc_bridges`

- `torrc` contains only `UseBridges 1` and `ClientTransportPlugin snowflake`.
- `apply-bridges` regenerates `/etc/tor/torrc_bridges` from UCI (`tor_pro`),
  including the required `ClientTransportPlugin <type> exec <binary>` lines
  for obfs4 / meek / snowflake transports (auto-deduped against torrc).
- `/etc/tor/torrc_bridges` is included via `tor.conf.tail_include`.

## Requirements

- OpenWrt 25.12.x (`mediatek/filogic` tested; should build for any target)
- `tor`, `luci-base`
- Optional transport proxies: `obfs4proxy`, `snowflake-client`, `meek-client`

## Build

```sh
# in the OpenWrt SDK
rsync -a --delete /path/to/luci-app-tor-jey/ feeds/luci/applications/luci-app-tor/
make package/feeds/luci/luci-app-tor/compile -j$(nproc)
```

The `.config` must contain `CONFIG_PACKAGE_luci-app-tor=m` and, for the Russian
translation, `CONFIG_LUCI_LANG_ru=y` (otherwise the i18n apk is skipped silently).

## Install (apk)

```sh
apk add --allow-untrusted luci-app-tor-*.apk
apk add --allow-untrusted luci-i18n-tor-ru-*.apk   # optional
/etc/init.d/rpcd restart
```

## RPC methods (`tor-pro-rpc`)

`status`, `config`, `devices`, `traffic`, `monitor`, `packages`, `bridge-types`,
`destinations`, `test-bridge`, `bridge-mon`, `bridge-mon-now`, `apply-bridges`,
`apply-routing`, `apply-monitor`, `install-package`.

## i18n

Russian (`po/ru/tor.po`) is updated for the new strings. Other locales keep
upstream translations.

## License

Apache-2.0 (see `LICENSE`). Original work by Sergey Ponomarev
<stokito@gmail.com>; this fork adds the extensions described above.
