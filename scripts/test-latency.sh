#!/bin/bash
# test-latency.sh
# LinuxCNC latency teszt

echo "=========================================="
echo "LinuxCNC Latency Teszt"
echo "=========================================="
echo ""
echo "Ez a teszt megméri a rendszer valós idejű"
echo "teljesítményét. A teszt közben:"
echo ""
echo "  1. Mozgasd az egeret"
echo "  2. Nyiss meg ablakokat"
echo "  3. Böngéssz az interneten"
echo "  4. Általában terheld a rendszert"
echo ""
echo "A teszt addig fut, amíg meg nem szakítod (Ctrl+C)."
echo ""
echo "Célértékek:"
echo "  Base thread max jitter: < 50,000 ns"
echo "  Servo thread max jitter: < 100,000 ns"
echo ""
echo "Indítás 3 másodperc múlva..."
sleep 3

latency-test
