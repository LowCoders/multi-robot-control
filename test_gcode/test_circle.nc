; Test Circle - Teszt kör minta
; R25mm kör a középpontban
; Becsült idő: 3 perc

G21 ; Metrikus mód
G90 ; Abszolút pozícionálás
G17 ; XY sík kiválasztása

; Kezdőpozíció
G0 Z10.0 ; Biztonsági magasság
G0 X50 Y25

; Spindle bekapcsolás
M3 S15000

; Lesüllyedés
G1 Z-3 F150

; Kör marás (óramutató járásával megegyező irányban)
G2 X50 Y25 I0 J25 F800

; Második menet (mélyebb)
G1 Z-6 F150
G2 X50 Y25 I0 J25 F800

; Harmadik menet
G1 Z-9 F150
G2 X50 Y25 I0 J25 F800

; Visszahúzás
G0 Z10.0
G0 X0 Y0

; Spindle kikapcsolás
M5

; Program vége
M30
