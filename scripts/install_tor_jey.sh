#!/usr/bin/env bash
###############################################################################
# install_tor_jey.sh — интерактивная установка luci-app-tor-jey на OpenWrt
#   (устройство Bazis AX3000WM, OpenWrt 25.12, apk-tools)
#
# Запуск:  bash install_tor_jey.sh
#   или из Windows:  wsl -e bash /mnt/c/.../install_tor_jey.sh
###############################################################################
set -uo pipefail

###############################################################################
# Пути к артефактам сборки (по умолчанию рядом со скриптом в out/ )
###############################################################################
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/out"
DEFAULT_IP="192.168.200.1"
DEFAULT_SSH_PORT="22"
DEFAULT_USER="root"
DEFAULT_PASS="1Qaz2wsx3edc"

###############################################################################
# Цвета и логгинг
###############################################################################
C_RED='\033[0;31m'; C_GRN='\033[0;32m'; C_YEL='\033[1;33m'; C_BLU='\033[0;34m'; C_NC='\033[0m'
info()  { printf "${C_BLU}[info]${C_NC} %s\n" "$*"; }
ok()    { printf "${C_GRN}[ ok ]${C_NC} %s\n" "$*"; }
warn()  { printf "${C_YEL}[ !  ]${C_NC} %s\n" "$*"; }
err()   { printf "${C_RED}[ERR ]${C_NC} %s\n" "$*" >&2; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

###############################################################################
# SSH-помощники
###############################################################################
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o BatchMode=no -o ConnectTimeout=10)

ssh_run() {
    local _ssh=(ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST")
    if [ "$HAVE_SSHPASS" = "y" ] && [ -n "$SSH_PASS" ]; then
        SSH_ASKPASS=/usr/bin/true sshpass -p "$SSH_PASS" "${_ssh[@]}" "$@"
    else
        "${_ssh[@]}" "$@"
    fi
}

ssh_run_batch() {
    local _ssh=(ssh "${SSH_OPTS[@]}" -o BatchMode=yes -p "$SSH_PORT" "$SSH_USER@$SSH_HOST")
    if [ "$HAVE_SSHPASS" = "y" ] && [ -n "$SSH_PASS" ]; then
        SSH_ASKPASS=/usr/bin/true sshpass -p "$SSH_PASS" "${_ssh[@]}" "$@"
    else
        "${_ssh[@]}" "$@"
    fi
}

scp_to() {
    local _scp=(scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -P "$SSH_PORT")
    if [ "$HAVE_SSHPASS" = "y" ] && [ -n "$SSH_PASS" ]; then
        SSH_ASKPASS=/usr/bin/true sshpass -p "$SSH_PASS" "${_scp[@]}" "$1" "$SSH_USER@$SSH_HOST:$2"
    else
        "${_scp[@]}" "$1" "$SSH_USER@$SSH_HOST:$2"
    fi
}

###############################################################################
# Интерактивный ввод
###############################################################################
ask() {
    # ask "вопрос" "значение по умолчанию" -> RETVAL
    local _q="$1" _d="$2" _r
    if [ -n "$_d" ]; then
        printf "%s [%s]: " "$_q" "$_d"
    else
        printf "%s: " "$_q"
    fi
    read -r _r || true
    RETVAL="${_r:-$_d}"
}

ask_secret() {
    local _q="$1" _d="$2" _r
    if [ -n "$_d" ]; then
        printf "%s [%s]: " "$_q" "$_d"
    else
        printf "%s: " "$_q"
    fi
    read -rs _r || true
    echo
    RETVAL="${_r:-$_d}"
}

ask_yn() {
    # ask_yn "вопрос" (y/n по умолчанию y) -> RETVAL=y/n
    local _q="$1" _d="${2:-y}" _r
    local _prompt
    if [ "$_d" = "y" ]; then _prompt="Y/n"; else _prompt="y/N"; fi
    printf "%s [%s]: " "$_q" "$_prompt"
    read -r _r || true
    _r="${_r:-$_d}"
    case "$_r" in
        y|Y|yes|YES|Yes) RETVAL="y" ;;
        n|N|no|NO|No)    RETVAL="n" ;;
        *)               RETVAL="$_d" ;;
    esac
}

###############################################################################
# Шаг 1 — параметры подключения
###############################################################################
step_connection() {
    echo
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  1 / 6 — Параметры подключения к устройству OpenWrt"
    echo "════════════════════════════════════════════════════════════════════════"
    ask "IP адрес устройства" "$DEFAULT_IP"; SSH_HOST="$RETVAL"
    ask "SSH порт" "$DEFAULT_SSH_PORT"; SSH_PORT="$RETVAL"
    ask "SSH пользователь" "$DEFAULT_USER"; SSH_USER="$RETVAL"
    ask_secret "SSH пароль" "$DEFAULT_PASS"; SSH_PASS="$RETVAL"

    # sshpass для интерактивного пароля
    HAVE_SSHPASS=n
    if have_cmd sshpass; then
        HAVE_SSHPASS=y
    elif ! have_cmd expect; then
        err "Нужен sshpass или expect для неинтерактивного входа по паролю."
        err "Установите: sudo apt-get install sshpass  (WSL/Ubuntu)"
        return 1
    fi

    # Проверка соединения
    info "Проверка соединения с $SSH_USER@$SSH_HOST:$SSH_PORT ..."
    _conn_ok=n
    if [ "$HAVE_SSHPASS" = "y" ]; then
        if ssh_run_batch "echo connected" 2>/dev/null | grep -q connected; then
            _conn_ok=y
        fi
    fi
    if [ "$_conn_ok" = "n" ]; then
        # пробуем без sshpass (ключ)
        if ssh_run_batch "echo connected" 2>/dev/null | grep -q connected; then
            _conn_ok=y
            SSH_PASS=""
        fi
    fi
    if [ "$_conn_ok" = "n" ]; then
        err "Не удалось подключиться к $SSH_HOST:$SSH_PORT."
        return 1
    fi
    ok "Соединение установлено."
    return 0
}

###############################################################################
# Шаг 2 — источник пакетов
###############################################################################
step_source() {
    echo
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  2 / 6 — Источник пакетов"
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  1) Локальные артефакты сборки (out/ luci-app-tor-*.apk)"
    echo "  2) GitHub Release (jeysson89/luci-app-tor-jey) — пока не опубликовано"
    echo "  3) Пропустить установку пакетов (только настройка Tor)"
    ask "Выберите источник [1-3]" "1"; PKG_SRC="$RETVAL"

    case "$PKG_SRC" in
        1)
            if [ ! -d "$OUT_DIR" ]; then
                err "Директория $OUT_DIR не найдена — сначала соберите пакеты (build_r14.sh)."
                return 1
            fi
            mapfile -t APK_FILES < <(ls "$OUT_DIR"/luci-app-tor-*.apk "$OUT_DIR"/luci-i18n-tor-ru-*.apk 2>/dev/null)
            if [ ${#APK_FILES[@]} -eq 0 ]; then
                err "APK-файлы не найдены в $OUT_DIR."
                return 1
            fi
            ok "Найдено APK: ${#APK_FILES[@]} шт."
            ls -1 "${APK_FILES[@]}" | sed 's|.*/||'
            ;;
        2)
            warn "GitHub Release ещё не создан. Опубликуйте release с .apk ассетами и повторите."
            return 1
            ;;
        3)
            info "Пропуск установки пакетов."
            ;;
        *)
            err "Неверный выбор."
            return 1
            ;;
    esac
    return 0
}

###############################################################################
# Шаг 3 — компоненты
###############################################################################
step_components() {
    echo
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  3 / 6 — Компоненты для установки"
    echo "════════════════════════════════════════════════════════════════════════"
    ask_yn "Установить luci-app-tor (LuCI интерфейс)?" "y"; INST_LUCI="$RETVAL"
    ask_yn "Установить luci-i18n-tor-ru (русский перевод)?" "y"; INST_I18N="$RETVAL"
    ask_yn "Установить tor (демон, если не стоит)?" "y"; INST_TOR="$RETVAL"
    ask_yn "Установить obfs4proxy (транспорт для obfs4-мостов)?" "y"; INST_OBF4="$RETVAL"
    ask_yn "Установить snowflake-client (транспорт snowflake)?" "y"; INST_SNOW="$RETVAL"
    return 0
}

###############################################################################
# Шаг 4 — мосты
###############################################################################
step_bridges() {
    echo
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  4 / 6 — Мосты (bridges)"
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  1) Пропустить (мосты уже настроены)"
    echo "  2) Импортировать из good_bridges.txt (Windows/WSL путь)"
    echo "  3) Ввести путь к файлу мостов вручную"
    ask "Выберите действие с мостами [1-3]" "1"; BRIDGE_ACT="$RETVAL"

    BRIDGE_FILE=""
    case "$BRIDGE_ACT" in
        2)
            local _default=""
            if [ -f "/mnt/c/Users/jeysson/tor-bridge-test/good_bridges.txt" ]; then
                _default="/mnt/c/Users/jeysson/tor-bridge-test/good_bridges.txt"
            fi
            ask "Путь к файлу мостов" "$_default"; BRIDGE_FILE="$RETVAL"
            if [ ! -f "$BRIDGE_FILE" ]; then
                err "Файл не найден: $BRIDGE_FILE"
                return 1
            fi
            ;;
        3)
            ask "Путь к файлу мостов" ""; BRIDGE_FILE="$RETVAL"
            if [ -z "$BRIDGE_FILE" ] || [ ! -f "$BRIDGE_FILE" ]; then
                err "Файл не найден."
                return 1
            fi
            ;;
    esac
    return 0
}

###############################################################################
# Шаг 5 — установка на устройство
###############################################################################
step_install() {
    echo
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  5 / 6 — Установка пакетов на устройство"
    echo "════════════════════════════════════════════════════════════════════════"

    local _cmd=""
    # Системные пакеты
    if [ "$INST_TOR" = "y" ]; then _cmd="$_cmd tor"; fi
    if [ "$INST_OBF4" = "y" ]; then _cmd="$_cmd obfs4proxy"; fi
    if [ "$INST_SNOW" = "y" ]; then _cmd="$_cmd snowflake-client"; fi
    if [ -n "$_cmd" ]; then
        info "Установка системных пакетов:$_cmd"
        ssh_run "apk update 2>&1 | tail -1; apk add $_cmd 2>&1 | tail -3" || {
            err "Не удалось установить системные пакеты."
            return 1
        }
        ok "Системные пакеты установлены."
    fi

    # LuCI пакеты
    if [ "$PKG_SRC" = "1" ]; then
        local _apk_list=()
        if [ "$INST_LUCI" = "y" ]; then
            _apk_list+=("$(ls "$OUT_DIR"/luci-app-tor-*.apk 2>/dev/null | head -1)")
        fi
        if [ "$INST_I18N" = "y" ]; then
            _apk_list+=("$(ls "$OUT_DIR"/luci-i18n-tor-ru-*.apk 2>/dev/null | head -1)")
        fi

        if [ ${#_apk_list[@]} -gt 0 ]; then
            local _f
            for _f in "${_apk_list[@]}"; do
                local _name; _name="$(basename "$_f")"
                info "Копирование $_name на устройство..."
                scp_to "$_f" "/tmp/$_name" || { err "SCP не удался для $_name"; return 1; }
                info "Установка $_name ..."
                ssh_run "apk add --allow-untrusted /tmp/$_name 2>&1 | tail -2" || {
                    err "Не удалось установить $_name."
                    return 1
                }
                rm -f "/tmp/$_name" 2>/dev/null
                ssh_run "rm -f /tmp/$_name" 2>/dev/null
            done
            ok "LuCI пакеты установлены."
        fi
    fi

    # Перезапуск rpcd (чтобы подхватились новые RPC-методы и ACL)
    info "Перезапуск rpcd ..."
    ssh_run "/etc/init.d/rpcd restart </dev/null >/dev/null 2>&1; sleep 2; rm -f /tmp/luci-indexcache-*.json" || true
    ok "rpcd перезапущен."
    return 0
}

###############################################################################
# Шаг 6 — настройка Tor и мостов
###############################################################################
step_configure() {
    echo
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  6 / 6 — Настройка Tor и мостов"
    echo "════════════════════════════════════════════════════════════════════════"

    # torrc — базовые настройки
    info "Проверка /etc/tor/torrc ..."
    local _torrc
    _torrc="$(ssh_run "cat /etc/tor/torrc" 2>/dev/null)" || _torrc=""

    if ! echo "$_torrc" | grep -q "^UseBridges 1"; then
        info "Добавление UseBridges 1 в torrc ..."
        ssh_run "printf '\nUseBridges 1\n' >> /etc/tor/torrc"
    fi
    if ! echo "$_torrc" | grep -q "ClientTransportPlugin snowflake"; then
        info "Добавление ClientTransportPlugin snowflake ..."
        ssh_run "printf 'ClientTransportPlugin snowflake exec /usr/bin/snowflake-client\n' >> /etc/tor/torrc"
    fi

    # Мосты: импорт из файла в UCI tor_pro (секции b1..bN)
    if [ -n "$BRIDGE_FILE" ]; then
        info "Импорт мостов из $BRIDGE_FILE ..."
        # Чистим CRLF/BOM, удаляем пустые строки и комментарии
        local _tmp_bridges="/tmp/good_bridges_clean.txt"
        sed 's/\r$//; /^[[:space:]]*#/d; /^[[:space:]]*$/d' "$BRIDGE_FILE" > "$_tmp_bridges"
        scp_to "$_tmp_bridges" "/tmp/good_bridges_clean.txt"
        rm -f "$_tmp_bridges"

        # Генератор UCI-команд (выполняется на устройстве)
        ssh_run <<'EOF'
set -e
n=0
while IFS= read -r line; do
    [ -z "$line" ] && continue
    n=$((n+1))
    sid="b${n}"
    case "$line" in
        obfs4\ *)  btype="obfs4"; baddr="${line#obfs4 }"; baddr="${baddr%% *}" ;;
        snowflake\ *) btype="snowflake"; baddr="${line#snowflake }"; baddr="${baddr%% *}" ;;
        meek\ *)   btype="meek-azure"; baddr="${line#meek-azure }"; baddr="${baddr%% *}" ;;
        *)         btype="vanilla"; baddr="${line%% *}" ;;
    esac
    [ -z "$baddr" ] && continue
    uci -q delete "tor_pro.${sid}" >/dev/null 2>&1 || true
    uci -q add tor_pro bridge >/dev/null
    uci -q set "tor_pro.${sid}.type=$btype"
    uci -q set "tor_pro.${sid}.enabled=1"
    uci -q set "tor_pro.${sid}.addr=$baddr"
done < /tmp/good_bridges_clean.txt
uci commit tor_pro
echo "Импортировано мостов: $n"
EOF
        if [ $? -ne 0 ]; then
            err "Ошибка импорта мостов в UCI."
            return 1
        fi
        ok "Мосты импортированы в UCI (tor_pro)."
    fi

    # Применяем мосты — генерируем torrc_bridges с ClientTransportPlugin
    info "Применение мостов (apply-bridges) ..."
    local _apply_out
    _apply_out="$(echo '{}' | ssh_run "/usr/libexec/rpcd/tor-pro-rpc call apply-bridges" 2>/dev/null)" || {
        err "RPC apply-bridges не удался."
        return 1
    }
    echo "$_apply_out" | grep -q '"status":"ok"' && ok "Мосты применены." || warn "apply-bridges вернул: $_apply_out"

    # Перезапуск tor
    info "Перезапуск tor ..."
    ssh_run "/etc/init.d/tor restart </dev/null >/dev/null 2>&1 || /etc/init.d/tor start </dev/null >/dev/null 2>&1; sleep 5" || true

    # Ожидание bootstrap
    info "Ожидание bootstrap Tor (до 60 с) ..."
    local _boot=""
    for i in $(seq 1 12); do
        _boot="$(ssh_run "ubus call tor-pro-rpc status 2>/dev/null | jsonfilter -e '@.tor.bootstrap'" 2>/dev/null)"
        case "$_boot" in
            100) ok "Bootstrap: 100%"; break ;;
            "") : ;;
            *) info "Bootstrap: $_boot% ... (попытка $i/12)" ;;
        esac
        sleep 5
    done

    # Финальный статус
    echo
    echo "════════════════════════════════════════════════════════════════════════"
    echo "  Готово!"
    echo "════════════════════════════════════════════════════════════════════════"
    local _st
    _st="$(ssh_run "ubus call tor-pro-rpc status 2>/dev/null" 2>/dev/null)"
    echo "$_st" | jsonfilter -e '@.tor.running' -e '@.tor.pid' -e '@.tor.bootstrap' -e '@.tor.guard' -e '@.tor.uptime' 2>/dev/null | tr '\n' ' '
    echo
    ok "LuCI: http://$SSH_HOST/cgi-bin/luci/admin/services/tor/bridges"
    return 0
}

###############################################################################
# main
###############################################################################
main() {
    echo "luci-app-tor-jey — интерактивный установщик"
    echo

    step_connection || return 1
    step_source || return 1
    step_components || return 1
    step_bridges || return 1

    echo
    ask_yn "Начать установку на $SSH_USER@$SSH_HOST?" "y" || { echo "Отменено пользователем."; return 0; }

    step_install || return 1
    step_configure || return 1

    echo
    ok "Установка завершена."
    return 0
}

main "$@"
