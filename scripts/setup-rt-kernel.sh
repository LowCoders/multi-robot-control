#!/bin/bash
# setup-rt-kernel.sh
# PREEMPT-RT / Lowlatency kernel telepítése LinuxCNC-hez
# Frissítve: 2026-01 - Ubuntu 24.04 támogatással

set -e

echo "=========================================="
echo "PREEMPT-RT / Lowlatency Kernel Telepítés"
echo "=========================================="

# Ellenőrzés: root jogok
if [ "$EUID" -ne 0 ]; then
    echo "Kérlek futtasd sudo-val: sudo $0"
    exit 1
fi

# Non-interactive mód
export DEBIAN_FRONTEND=noninteractive

# Aktuális kernel
CURRENT_KERNEL=$(uname -r)
echo "Jelenlegi kernel: $CURRENT_KERNEL"

# Már RT/lowlatency kernel fut?
if [[ "$CURRENT_KERNEL" == *"rt"* ]] || [[ "$CURRENT_KERNEL" == *"lowlatency"* ]]; then
    echo ""
    echo "Már PREEMPT-RT vagy lowlatency kernel fut!"
    echo "Nincs szükség további telepítésre."
    echo ""
    echo "Kernel típus ellenőrzése:"
    cat /sys/kernel/realtime 2>/dev/null && echo "  -> PREEMPT-RT aktív" || echo "  -> Lowlatency kernel"
    exit 0
fi

# Disztribúció ellenőrzése
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
    VERSION=$VERSION_ID
    CODENAME=$VERSION_CODENAME
else
    echo "Nem sikerült azonosítani a disztribúciót"
    exit 1
fi

echo "Disztribúció: $DISTRO $VERSION ($CODENAME)"
echo ""

# Kernel telepítése disztribúció szerint
case $DISTRO in
    debian)
        echo "[1/3] PREEMPT-RT kernel telepítése (Debian)..."
        apt-get update -qq
        
        # Debian esetén próbáljuk a full RT kernelt
        if apt-cache show linux-image-rt-amd64 &>/dev/null; then
            apt-get install -y linux-image-rt-amd64
            INSTALLED_KERNEL="rt"
        else
            echo "RT kernel nem elérhető, lowlatency próbálása..."
            apt-get install -y linux-image-lowlatency 2>/dev/null || {
                echo "HIBA: Sem RT sem lowlatency kernel nem telepíthető"
                exit 1
            }
            INSTALLED_KERNEL="lowlatency"
        fi
        ;;
        
    ubuntu)
        echo "[1/3] Kernel telepítése (Ubuntu)..."
        apt-get update -qq
        
        # Ubuntu verzió alapján
        case $CODENAME in
            noble|mantic|lunar|jammy)
                # Ubuntu 22.04+ - lowlatency elérhető
                echo "Lowlatency kernel telepítése..."
                apt-get install -y linux-lowlatency
                INSTALLED_KERNEL="lowlatency"
                
                # Ha van HWE kernel, azt is telepítjük
                if apt-cache show linux-lowlatency-hwe-${VERSION} &>/dev/null 2>&1; then
                    apt-get install -y linux-lowlatency-hwe-${VERSION} 2>/dev/null || true
                fi
                ;;
            focal)
                # Ubuntu 20.04
                apt-get install -y linux-lowlatency
                INSTALLED_KERNEL="lowlatency"
                ;;
            *)
                echo "Ismeretlen Ubuntu verzió, lowlatency próbálása..."
                apt-get install -y linux-lowlatency 2>/dev/null || {
                    echo "HIBA: Lowlatency kernel nem telepíthető"
                    exit 1
                }
                INSTALLED_KERNEL="lowlatency"
                ;;
        esac
        
        # Ubuntu esetén PREEMPT-RT kernel is lehet elérhető (24.04+)
        if [[ "$CODENAME" == "noble" ]] || [[ "$CODENAME" == "mantic" ]]; then
            if apt-cache show linux-image-realtime &>/dev/null 2>&1; then
                echo ""
                echo "Ubuntu PREEMPT-RT kernel is elérhető!"
                echo "Telepíted? (alapértelmezés: nem)"
                echo "  apt install linux-image-realtime"
            fi
        fi
        ;;
        
    *)
        echo "Nem támogatott disztribúció: $DISTRO"
        echo "Kérlek telepítsd manuálisan a PREEMPT-RT vagy lowlatency kernelt"
        exit 1
        ;;
esac

echo ""
echo "[2/3] GRUB konfiguráció optimalizálása..."

GRUB_FILE="/etc/default/grub"

if [ ! -f "$GRUB_FILE" ]; then
    echo "GRUB konfig nem található: $GRUB_FILE"
    echo "GRUB optimalizálás kihagyva"
else
    # Backup
    GRUB_BACKUP="${GRUB_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$GRUB_FILE" "$GRUB_BACKUP"
    echo "Backup mentve: $GRUB_BACKUP"

    # Kernel paraméterek
    # isolcpus=1 - egy CPU mag elkülönítése valós idejű feladatokhoz
    # intel_pstate=disable - Intel CPU frekvencia scaling kikapcsolása
    # processor.max_cstate=1 - C-state korlátozása (alacsony latencia)
    # idle=poll - idle polling (alacsonyabb latencia, magasabb fogyasztás)
    
    CMDLINE_ADD=""
    
    # CPU izolálás (opcionális, több magos rendszerhez)
    # Ezt csak akkor állítsd be, ha legalább 4 magod van
    NPROC=$(nproc)
    if [ "$NPROC" -ge 4 ]; then
        CMDLINE_ADD="isolcpus=1"
    fi
    
    # Intel CPU optimalizálás
    if grep -q "GenuineIntel" /proc/cpuinfo; then
        CMDLINE_ADD="$CMDLINE_ADD intel_pstate=disable"
    fi
    
    # AMD CPU optimalizálás
    if grep -q "AuthenticAMD" /proc/cpuinfo; then
        CMDLINE_ADD="$CMDLINE_ADD amd_pstate=disable"
    fi
    
    # Meglévő paraméterek módosítása
    if [ -n "$CMDLINE_ADD" ]; then
        CURRENT=$(grep "^GRUB_CMDLINE_LINUX=" "$GRUB_FILE" 2>/dev/null | cut -d'"' -f2 || echo "")
        
        # Csak ha még nincs benne
        UPDATED=false
        for param in $CMDLINE_ADD; do
            key=$(echo "$param" | cut -d'=' -f1)
            if [[ ! "$CURRENT" == *"$key"* ]]; then
                CURRENT="$CURRENT $param"
                UPDATED=true
            fi
        done
        
        if [ "$UPDATED" = true ]; then
            # Whitespace tisztítása
            CURRENT=$(echo "$CURRENT" | xargs)
            sed -i "s|^GRUB_CMDLINE_LINUX=.*|GRUB_CMDLINE_LINUX=\"$CURRENT\"|" "$GRUB_FILE"
            echo "Kernel paraméterek frissítve: $CURRENT"
        else
            echo "Kernel paraméterek már beállítva"
        fi
    fi
    
    # GRUB frissítése
    if command -v update-grub &>/dev/null; then
        update-grub
    elif command -v grub-mkconfig &>/dev/null; then
        grub-mkconfig -o /boot/grub/grub.cfg
    else
        echo "FIGYELEM: GRUB frissítő parancs nem található"
    fi
fi

echo ""
echo "[3/3] Telepítés ellenőrzése..."

# Elérhető kernelek listázása
echo ""
echo "Telepített kernelek:"
dpkg -l | grep -E "linux-image-(rt|lowlatency|realtime)" | awk '{print "  " $2 " - " $3}'

echo ""
echo "=========================================="
echo "FONTOS: Újraindítás szükséges!"
echo "=========================================="
echo ""
echo "Telepített kernel: $INSTALLED_KERNEL"
echo ""
echo "Újraindítás után:"
echo "  1. Ellenőrizd a kernelt: uname -r"
echo "  2. Ellenőrizd az RT támogatást: cat /sys/kernel/realtime"
echo "  3. Futtasd a latency tesztet: latency-test"
echo "  4. Folytasd: sudo ./scripts/install-linuxcnc.sh"
echo ""
echo "Cél értékek latencia teszthez:"
echo "  Base thread jitter: < 50,000 ns (50 µs)"
echo "  Servo thread jitter: < 100,000 ns (100 µs)"
echo ""
echo "Újraindításhoz: sudo reboot"
