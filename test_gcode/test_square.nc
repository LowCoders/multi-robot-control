; Test Square - Teszt négyzet minta
; 50mm x 50mm négyzet Z-5mm mélységben
; Becsült idő: 2 perc

G21 ; Metrikus mód
G90 ; Abszolút pozícionálás
G17 ; XY sík kiválasztása

; Kezdőpozíció
G0 Z5.0 ; Biztonsági magasság
G0 X0 Y0

; Spindle bekapcsolás
M3 S12000

; Első oldal
G0 X10 Y10
G1 Z-5 F200
G1 X60 Y10 F1000
G1 X60 Y60
G1 X10 Y60
G1 X10 Y10

; Második menet (mélyebb)
G1 Z-10 F200
G1 X60 Y10 F1000
G1 X60 Y60
G1 X10 Y60
G1 X10 Y10

; Visszahúzás
G0 Z5.0
G0 X0 Y0

; Spindle kikapcsolás
M5

; Program vége
M30
