#!/bin/sh
###############################################################################
# install_tor_jey_on_device.sh
# Интерактивная установка luci-app-tor-jey прямо на устройстве OpenWrt
# (терминал / SSH, apk-tools, uci, rpcd)
#
# Запуск на роутере:
#   sh install_tor_jey_on_device.sh
###############################################################################
set -u

# ---------------------------------------------------------------- цвета -----
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; BLU='\033[0;34m'; NC='\033[0m'
info() { printf "${BLU}[info]${NC} %s\n" "$*"; }
ok()   { printf "${GRN}[ ok ]${NC} %s\n" "$*"; }
warn() { printf "${YEL}[ !  ]${NC} %s\n" "$*"; }
err()  { printf "${RED}[ERR ]${NC} %s\n" "$*" >&2; }

# ---------------------------------------------------------------- проверки --
[ "$(id -u)" -eq 0 ] || { err "Запустите скрипт от root"; exit 1; }
command -v apk   >/dev/null 2>&1 || { err "apk не найден (не OpenWrt?)"; exit 1; }
command -v uci   >/dev/null 2>&1 || { err "uci не найден"; exit 1; }

# ---------------------------------------------------------------- пакеты ----
PKG_TOR="tor"
PKG_LUCI="luci-app-tor"
PKG_I18N="luci-i18n-tor-ru"
PKG_OBF4="obfs4proxy"
PKG_SNOW="snowflake-client"

is_installed() {
    # apk list --installed выдаёт "имя-версия ..."
    apk list --installed 2>/dev/null | grep -qE "^$1-[0-9]"
}

ask_yn() {
    # $1 вопрос, $2 умолчание (y/n). Возвращает 0 (да) или 1 (нет)
    local q="$1" d="${2:-n}" r
    printf "%s [%s]: " "$q" "$d"
    read -r r
    [ -z "$r" ] && r="$d"
    case "$r" in
        y|Y) return 0 ;;
        n|N) return 1 ;;
        *)   ask_yn "$q" "$d" ;;
    esac
}

# ---------------------------------------------------------------- состояние -
echo "════════════════════════════════════════════════════════════════════════"
echo "  luci-app-tor-jey — установщик на устройстве OpenWrt"
echo "════════════════════════════════════════════════════════════════════════"

inst_tor=0; inst_luci=0; inst_i18n=0; inst_obfs4=0; inst_snow=0

is_installed "$PKG_TOR"     && inst_tor=1     && ok "$PKG_TOR установлен"     || warn "$PKG_TOR не установлен"
is_installed "$PKG_LUCI"    && inst_luci=1    && ok "$PKG_LUCI установлен"    || warn "$PKG_LUCI не установлен"
is_installed "$PKG_I18N"    && inst_i18n=1    && ok "$PKG_I18N установлен"    || warn "$PKG_I18N не установлен"
is_installed "$PKG_OBF4"    && inst_obfs4=1   && ok "$PKG_OBF4 установлен"    || warn "$PKG_OBF4 не установлен"
is_installed "$PKG_SNOW"    && inst_snow=1    && ok "$PKG_SNOW установлен"    || warn "$PKG_SNOW не установлен"

# ------------------------------------------------------------- повторный запуск
if [ "$inst_tor" = 1 ] && [ "$inst_luci" = 1 ] && [ "$inst_i18n" = 1 ]; then
    echo
    warn "Все основные компоненты уже установлены."
    if ask_yn "Повторный запуск — удалить всё и хвосты (полная очистка)?" "n"; then
        info "Удаление пакетов..."
        apk del "$PKG_LUCI" "$PKG_I18N" "$PKG_TOR" "$PKG_OBF4" "$PKG_SNOW" 2>/dev/null || true

        info "Очистка конфигурации Tor..."
        rm -f /etc/tor/torrc_bridges 2>/dev/null

        info "Очистка UCI tor_pro (секции мостов)..."
        for s in $(uci -q show tor_pro 2>/dev/null | grep '=bridge$' | cut -d= -f1 | cut -d. -f2); do
            uci -q delete "tor_pro.$s" >/dev/null 2>&1
        done
        uci -q commit tor_pro >/dev/null 2>&1 || true

        info "Очистка временных файлов..."
        rm -f /tmp/tor_pro_boot.* /tmp/good_bridges_clean.txt /tmp/*.apk 2>/dev/null

        info "Перезапуск сервисов..."
        /etc/init.d/rpcd restart >/dev/null 2>&1 || true
        /etc/init.d/tor restart >/dev/null 2>&1 || true

        ok "Полная очистка завершена. Запустите скрипт снова для свежей установки."
        exit 0
    else
        info "Продолжаем без удаления."
    fi
fi

# ------------------------------------------------------------- установка ---
echo
info "Проверка недостающих пакетов..."
need_tor=0; need_luci=0; need_i18n=0; need_obfs4=0; need_snow=0
[ "$inst_tor"     = 1 ] || need_tor=1
[ "$inst_luci"    = 1 ] || need_luci=1
[ "$inst_i18n"    = 1 ] || need_i18n=1
[ "$inst_obfs4"   = 1 ] || need_obfs4=1
[ "$inst_snow"    = 1 ] || need_snow=1

to_install=""
[ "$need_tor"     = 1 ] && to_install="$to_install $PKG_TOR"
[ "$need_luci"    = 1 ] && to_install="$to_install $PKG_LUCI"
[ "$need_i18n"    = 1 ] && to_install="$to_install $PKG_I18N"
[ "$need_obfs4"   = 1 ] && to_install="$to_install $PKG_OBF4"
[ "$need_snow"    = 1 ] && to_install="$to_install $PKG_SNOW"

if [ -n "$to_install" ]; then
    warn "Требуются пакеты:$to_install"
    ask_yn "Установить их сейчас?" "y" || { err "Установка отменена"; exit 1; }

    # источник пакетов
    echo
    echo "  1) Локальные *.apk в текущей папке (от build_r14.sh)"
    echo "  2) Из интернет-репозитория apk"
    ask "Выберите источник [1-2]" "1"; src="$RETVAL"

    if [ "$src" = "1" ]; then
        # ищем apk в текущей папке
        found=0
        for p in $to_install; do
            f=$(ls "$p"-*.apk 2>/dev/null | head -1)
            if [ -n "$f" ]; then
                info "Найден локальный пакет: $f"
                apk add --allow-untrusted "$f" >/dev/null 2>&1 && ok "Установлен $f" || err "Не удалось установить $f"
                found=1
            else
                warn "Локальный apk для $p не найден в текущей папке"
            fi
        done
        if [ "$found" = 0 ]; then
            err "Локальные apk не найдены. Положите *.apk в эту папку и запустите снова."
            exit 1
        fi
    else
        info "Обновление списка пакетов..."
        apk update >/dev/null 2>&1 || warn "apk update не удался (продолжаем)"
        info "Установка:$to_install"
        apk add $to_install || { err "Не удалось установить пакеты из репозитория"; exit 1; }
        ok "Пакеты установлены из репозитория."
    fi
else
    ok "Все необходимые пакеты уже установлены."
fi

# ------------------------------------------------------------- настройка torrc
echo
info "Настройка /etc/tor/torrc ..."
if ! grep -qE '^[[:space:]]*UseBridges[[:space:]]+1' /etc/tor/torrc 2>/dev/null; then
    printf '\nUseBridges 1\n' >> /etc/tor/torrc
    ok "Добавлено: UseBridges 1"
else
    info "UseBridges 1 уже есть в torrc"
fi

if ! grep -q 'ClientTransportPlugin snowflake' /etc/tor/torrc 2>/dev/null; then
    printf 'ClientTransportPlugin snowflake exec /usr/bin/snowflake-client\n' >> /etc/tor/torrc
    ok "Добавлено: ClientTransportPlugin snowflake"
else
    info "ClientTransportPlugin snowflake уже есть в torrc"
fi

# ------------------------------------------------------------- импорт мостов ---
echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  Импорт мостов (bridges)"
echo "════════════════════════════════════════════════════════════════════════"
echo "  1) Пропустить (мосты уже настроены в UCI)"
echo "  2) Импортировать из good_bridges.txt (в текущей папке)"
echo "  3) Указать свой файл со списком мостов"
ask "Выберите действие [1-3]" "1"; bridge_act="$RETVAL"

bridge_file=""
case "$bridge_act" in
    2)
        if [ -f "./good_bridges.txt" ]; then
            bridge_file="./good_bridges.txt"
        else
            err "good_bridges.txt не найден в текущей папке"
            exit 1
        fi
        ;;
    3)
        ask "Путь к файлу мостов" ""; bridge_file="$RETVAL"
        [ -z "$bridge_file" ] || [ ! -f "$bridge_file" ] && { err "Файл не найден"; exit 1; }
        ;;
esac

if [ -n "$bridge_file" ]; then
    info "Очистка старых секций мостов в UCI..."
    for s in $(uci -q show tor_pro 2>/dev/null | grep '=bridge$' | cut -d= -f1 | cut -d. -f2); do
        uci -q delete "tor_pro.$s" >/dev/null 2>&1
    done

    info "Чистка файла мостов (CRLF/BOM, комментарии, пустые строки)..."
    sed 's/\r$//; /^[[:space:]]*#/d; /^[[:space:]]*$/d' "$bridge_file" > /tmp/good_bridges_clean.txt

    info "Импорт мостов в UCI tor_pro..."
    n=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        n=$((n + 1))
        sid="b${n}"
        case "$line" in
            obfs4\ *)  btype="obfs4";  baddr="${line#obfs4 }";  baddr="${baddr%% *}" ;;
            snowflake\ *) btype="snowflake"; baddr="${line#snowflake }"; baddr="${baddr%% *}" ;;
            meek\ *)   btype="meek-azure"; baddr="${line#meek-azure }"; baddr="${baddr%% *}" ;;
            *)         btype="vanilla"; baddr="${line%% *}" ;;
        esac
        [ -z "$baddr" ] && continue
        uci -q add tor_pro bridge >/dev/null
        uci -q set "tor_pro.${sid}.type=$btype"
        uci -q set "tor_pro.${sid}.enabled=1"
        uci -q set "tor_pro.${sid}.addr=$baddr"
    done < /tmp/good_bridges_clean.txt
    uci -q commit tor_pro >/dev/null 2>&1
    ok "Импортировано мостов: $n (секции b1..b$n)"
fi

# ------------------------------------------------------------- apply bridges ---
echo
info "Применение мостов (generate /etc/tor/torrc_bridges) ..."
if [ -x /usr/libexec/rpcd/tor-pro-rpc ]; then
    out=$(echo '{}' | /usr/libexec/rpcd/tor-pro-rpc call apply-bridges 2>/dev/null)
    echo "$out" | grep -q '"status":"ok"' && ok "Мосты применены через RPC" || warn "RPC apply-bridges: $out"
else
    warn "/usr/libexec/rpcd/tor-pro-rpc не найден — torrc_bridges нужно сгенерировать вручную или через LuCI"
fi

# ------------------------------------------------------------- перезапуск -----
echo
info "Перезапуск tor и rpcd ..."
/etc/init.d/rpcd restart >/dev/null 2>&1 || true
sleep 2
/etc/init.d/tor restart >/dev/null 2>&1 || /etc/init.d/tor start >/dev/null 2>&1 || true
sleep 5

# ------------------------------------------------------------- статус -------
echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  Финальный статус"
echo "════════════════════════════════════════════════════════════════════════"

if command -v ubus >/dev/null 2>&1 && command -v jsonfilter >/dev/null 2>&1; then
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        st=$(ubus call tor-pro-rpc status 2>/dev/null | jsonfilter -e '@.tor.running' -e '@.tor.bootstrap' -e '@.tor.guard' -e '@.tor.uptime' 2>/dev/null | tr '\n' ' ')
        case "$st" in
            *100*) ok "Статус: $st"; break ;;
            "") warn "Ожидание данных tor..." ;;
            *) info "Попытка $i/12: $st" ;;
        esac
        sleep 3
    done
else
    warn "ubus/jsonfilter не найдены — проверьте статус вручную: /etc/init.d/tor status"
fi

echo
echo "Мосты в /etc/tor/torrc_bridges: $(grep -cE '^Bridge' /etc/tor/torrc_bridges 2>/dev/null || echo 0)"
echo "Плагины в torrc_bridges:        $(grep -cE 'ClientTransportPlugin' /etc/tor/torrc_bridges 2>/dev/null || echo 0)"
echo
ok "Готово. LuCI: http://$(uci -q get network.lan.ipaddr 2>/dev/null || echo ROUTER_IP)/cgi-bin/luci/admin/services/tor/bridges"
exit 0
