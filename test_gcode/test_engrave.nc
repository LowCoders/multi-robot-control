; Test Engrave - Teszt gravírozás
; "TEST" szöveg gravírozása
; Becsült idő: 5 perc

G21 ; Metrikus mód
G90 ; Abszolút pozícionálás
G17 ; XY sík kiválasztása

; Kezdőpozíció
G0 Z5.0 ; Biztonsági magasság
G0 X0 Y0

; Lézer/Spindle bekapcsolás
M3 S8000

; === T betű ===
G0 X10 Y40
G1 Z-0.5 F100
G1 X20 Y40 F500
G0 Z2
G0 X15 Y40
G1 Z-0.5 F100
G1 X15 Y25 F500
G0 Z2

; === E betű ===
G0 X25 Y40
G1 Z-0.5 F100
G1 X35 Y40 F500
G0 Z2
G0 X25 Y40
G1 Z-0.5 F100
G1 X25 Y25 F500
G0 Z2
G0 X25 Y32.5
G1 Z-0.5 F100
G1 X32 Y32.5 F500
G0 Z2
G0 X25 Y25
G1 Z-0.5 F100
G1 X35 Y25 F500
G0 Z2

; === S betű ===
G0 X50 Y40
G1 Z-0.5 F100
G1 X40 Y40 F500
G1 X40 Y32.5 F500
G1 X50 Y32.5 F500
G1 X50 Y25 F500
G1 X40 Y25 F500
G0 Z2

; === T betű (második) ===
G0 X55 Y40
G1 Z-0.5 F100
G1 X65 Y40 F500
G0 Z2
G0 X60 Y40
G1 Z-0.5 F100
G1 X60 Y25 F500
G0 Z2

; Visszahúzás
G0 Z5.0
G0 X0 Y0

; Spindle/Lézer kikapcsolás
M5

; Program vége
M30
