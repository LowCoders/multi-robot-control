#!/bin/bash
# setup-rt-kernel.sh
# PREEMPT-RT / Lowlatency kernel telepítése LinuxCNC-hez
# Frissítve: 2026-01 - Ubuntu 24.04 támogatással
#
# Ubuntu 24.04+ megjegyzés:
# Az Ubuntu 24.04-től kezdve a lowlatency nem külön kernel image,
# hanem a generic kernel + boot paraméterek (preempt=full, rcu_nocbs=all, stb.)
# A linux-lowlatency-hwe-24.04 csomag ezt konfigurálja automatikusan.

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

# Aktuális kernel és boot paraméterek
CURRENT_KERNEL=$(uname -r)
CMDLINE=$(cat /proc/cmdline)
echo "Jelenlegi kernel: $CURRENT_KERNEL"

# Lowlatency/RT állapot ellenőrzése
check_rt_status() {
    local is_rt=false
    local rt_type=""
    
    # 1. PREEMPT_RT kernel (pl. Debian RT vagy Ubuntu realtime)
    if [ -f /sys/kernel/realtime ] && [ "$(cat /sys/kernel/realtime 2>/dev/null)" = "1" ]; then
        is_rt=true
        rt_type="PREEMPT_RT kernel"
    # 2. Lowlatency kernel image (régebbi Ubuntu)
    elif [[ "$CURRENT_KERNEL" == *"lowlatency"* ]]; then
        is_rt=true
        rt_type="Lowlatency kernel image"
    # 3. RT kernel image
    elif [[ "$CURRENT_KERNEL" == *"-rt"* ]]; then
        is_rt=true
        rt_type="RT kernel image"
    # 4. Ubuntu 24.04+ módszer: preempt=full boot paraméter
    elif echo "$CMDLINE" | grep -q "preempt=full"; then
        is_rt=true
        rt_type="Lowlatency boot paraméterek (preempt=full)"
    fi
    
    if [ "$is_rt" = true ]; then
        echo ""
        echo "✅ Valós idejű / lowlatency konfiguráció aktív!"
        echo "   Típus: $rt_type"
        echo ""
        echo "Boot paraméterek:"
        echo "$CMDLINE" | tr ' ' '\n' | grep -E "preempt|isolcpus|rcu_nocbs|pstate" | sed 's/^/   /'
        echo ""
        
        # CPU izolálás ellenőrzése
        if [ -f /sys/devices/system/cpu/isolated ]; then
            ISOLATED=$(cat /sys/devices/system/cpu/isolated)
            if [ -n "$ISOLATED" ]; then
                echo "Izolált CPU-k: $ISOLATED"
            fi
        fi
        
        return 0
    fi
    return 1
}

# Már megfelelő konfiguráció fut?
if check_rt_status; then
    echo ""
    echo "Nincs szükség további telepítésre."
    echo ""
    echo "Következő lépés: LinuxCNC telepítése"
    echo "  sudo ./scripts/install-linuxcnc.sh"
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
        apt-get update -qq 2>/dev/null || echo "APT frissítés figyelmeztetésekkel (folytatás...)"
        
        # Debian esetén próbáljuk a full RT kernelt
        if apt-cache show linux-image-rt-amd64 &>/dev/null; then
            apt-get install -y linux-image-rt-amd64
            INSTALLED_KERNEL="linux-image-rt-amd64"
        else
            echo "RT kernel nem elérhető"
            exit 1
        fi
        ;;
        
    ubuntu)
        echo "[1/3] Lowlatency konfiguráció telepítése (Ubuntu)..."
        apt-get update -qq 2>/dev/null || echo "APT frissítés figyelmeztetésekkel (folytatás...)"
        
        # Ubuntu verzió alapján
        case $CODENAME in
            noble)
                # Ubuntu 24.04 - HWE lowlatency csomag (boot paraméterek)
                echo ""
                echo "Ubuntu 24.04 detektálva."
                echo "A lowlatency most boot paraméterekkel működik, nem külön kernellel."
                echo ""
                
                # HWE verzió telepítése (ez a legfrissebb kernel + lowlatency config)
                echo "linux-lowlatency-hwe-24.04 telepítése..."
                apt-get install -y linux-lowlatency-hwe-24.04
                INSTALLED_KERNEL="linux-lowlatency-hwe-24.04"
                ;;
                
            mantic|lunar)
                # Ubuntu 23.x
                echo "linux-lowlatency telepítése..."
                apt-get install -y linux-lowlatency
                INSTALLED_KERNEL="linux-lowlatency"
                ;;
                
            jammy)
                # Ubuntu 22.04 - még külön kernel image
                echo "linux-lowlatency-hwe-22.04 telepítése..."
                apt-get install -y linux-lowlatency-hwe-22.04 2>/dev/null || \
                    apt-get install -y linux-lowlatency
                INSTALLED_KERNEL="linux-lowlatency-hwe-22.04"
                ;;
                
            focal)
                # Ubuntu 20.04
                apt-get install -y linux-lowlatency-hwe-20.04 2>/dev/null || \
                    apt-get install -y linux-lowlatency
                INSTALLED_KERNEL="linux-lowlatency"
                ;;
                
            *)
                echo "Ismeretlen Ubuntu verzió: $CODENAME"
                echo "linux-lowlatency próbálása..."
                apt-get install -y linux-lowlatency 2>/dev/null || {
                    echo "HIBA: Lowlatency kernel nem telepíthető"
                    exit 1
                }
                INSTALLED_KERNEL="linux-lowlatency"
                ;;
        esac
        
        # Ubuntu 24.04+ esetén PREEMPT_RT is elérhető lehet
        if [[ "$CODENAME" == "noble" ]]; then
            if apt-cache show linux-realtime &>/dev/null 2>&1; then
                echo ""
                echo "ℹ️  Ubuntu PREEMPT_RT kernel is elérhető!"
                echo "   Ha alacsonyabb latencia kell: sudo apt install linux-realtime"
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
echo "[2/3] GRUB konfiguráció ellenőrzése..."

GRUB_FILE="/etc/default/grub"

if [ ! -f "$GRUB_FILE" ]; then
    echo "GRUB konfig nem található: $GRUB_FILE"
    echo "GRUB optimalizálás kihagyva"
else
    # Backup
    GRUB_BACKUP="${GRUB_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$GRUB_FILE" "$GRUB_BACKUP"
    echo "Backup mentve: $GRUB_BACKUP"

    # Kernel paraméterek (csak ha még nincsenek beállítva)
    CMDLINE_ADD=""
    
    # CPU izolálás (4+ magos rendszerhez)
    NPROC=$(nproc)
    if [ "$NPROC" -ge 4 ] && ! echo "$CMDLINE" | grep -q "isolcpus"; then
        CMDLINE_ADD="isolcpus=1"
    fi
    
    # Intel CPU optimalizálás
    if grep -q "GenuineIntel" /proc/cpuinfo && ! echo "$CMDLINE" | grep -q "intel_pstate"; then
        CMDLINE_ADD="$CMDLINE_ADD intel_pstate=disable"
    fi
    
    # AMD CPU optimalizálás
    if grep -q "AuthenticAMD" /proc/cpuinfo && ! echo "$CMDLINE" | grep -q "amd_pstate"; then
        CMDLINE_ADD="$CMDLINE_ADD amd_pstate=disable"
    fi
    
    # Preempt=full (Ubuntu 24.04+ esetén a lowlatency csomag beállítja, de biztosítjuk)
    if [[ "$CODENAME" == "noble" ]] && ! echo "$CMDLINE" | grep -q "preempt=full"; then
        CMDLINE_ADD="$CMDLINE_ADD preempt=full"
    fi
    
    # Paraméterek hozzáadása
    if [ -n "$CMDLINE_ADD" ]; then
        CMDLINE_ADD=$(echo "$CMDLINE_ADD" | xargs)  # trim
        CURRENT=$(grep "^GRUB_CMDLINE_LINUX=" "$GRUB_FILE" 2>/dev/null | cut -d'"' -f2 || echo "")
        
        # Hozzáadás a meglévőkhöz
        for param in $CMDLINE_ADD; do
            key=$(echo "$param" | cut -d'=' -f1)
            if [[ ! "$CURRENT" == *"$key"* ]]; then
                CURRENT="$CURRENT $param"
            fi
        done
        
        CURRENT=$(echo "$CURRENT" | xargs)
        sed -i "s|^GRUB_CMDLINE_LINUX=.*|GRUB_CMDLINE_LINUX=\"$CURRENT\"|" "$GRUB_FILE"
        echo "Kernel paraméterek: $CURRENT"
        
        # GRUB frissítése
        if command -v update-grub &>/dev/null; then
            update-grub
        elif command -v grub-mkconfig &>/dev/null; then
            grub-mkconfig -o /boot/grub/grub.cfg
        fi
    else
        echo "Kernel paraméterek már optimálisan beállítva"
    fi
fi

echo ""
echo "[3/3] Telepítés ellenőrzése..."

# Telepített csomagok
echo ""
echo "Telepített lowlatency/RT csomagok:"
dpkg -l | grep -E "linux-(lowlatency|realtime|rt)" | grep "^ii" | awk '{print "  ✓ " $2 " (" $3 ")"}'

echo ""
echo "=========================================="
echo "Telepítés befejezve!"
echo "=========================================="
echo ""
echo "Telepített csomag: $INSTALLED_KERNEL"
echo ""

# Ubuntu 24.04 specifikus info
if [[ "$CODENAME" == "noble" ]]; then
    echo "ℹ️  Ubuntu 24.04 információ:"
    echo "   A lowlatency a következő boot paraméterekkel működik:"
    echo "   - preempt=full (teljes preemption)"
    echo "   - rcu_nocbs=all (RCU callback offload)"
    echo ""
fi

echo "🔄 ÚJRAINDÍTÁS szükséges a változások aktiválásához!"
echo ""
echo "Újraindítás után ellenőrizd:"
echo "  1. cat /proc/cmdline | grep preempt"
echo "  2. cat /sys/devices/system/cpu/isolated"
echo "  3. Latencia teszt (ha LinuxCNC telepítve): latency-test"
echo ""
echo "Következő lépés:"
echo "  sudo ./scripts/install-linuxcnc.sh"
echo ""
echo "Újraindításhoz: sudo reboot"
