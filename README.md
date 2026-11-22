# Operation Black Tornado — 26/11 co-op mission

A browser-based 3D co-op tactical shooter (1–4 players), dramatising the NSG response to the
Taj Mahal Palace hotel siege in Mumbai on 26 November 2008. Made in memory of the victims and responders.

## Run
```
npm install
npm start          # http://localhost:3000
```
Friends on the same network or on a hosted server open the same URL and type the same **squad room code**.
Dev shortcuts: `/#taj` (night, burning Taj, red zone) · `/#assault` (straight into the hotel).

## Story flow
1. Spawn in Colaba (golden hour) → go to the **yellow marker** to meet Col. Rathore.
2. He tells you training is done, gives keys and **secure military phones** → go to the safehouse.
3. Time skips to night → **phone alert**: the Taj is under attack → go to the **red zone**.
4. Black-screen **cinematic narration** of the real events → each player **chooses a role**
   (AK-47 assault, M4 rifleman, shotgun breacher, PSG-1 sniper).
5. Assault the Taj interior: 10 hostiles (riflemen, **suicide bombers** who charge or blast when killed,
   and a **machine-gunner in a sandbag nest** as the climax), 8 hostages, fires, grenades.
6. Win: kill all 10 and **at least one player reaches exfil**. Lose: whole squad down, or 3 hostages killed.

## Controls
WASD · Shift sprint · Space jump · Mouse aim · LMB fire · RMB aim/scope · R reload · G grenade ·
E interact / evacuate hostage / revive teammate · 1 phone · Tab squad

## Tech
Three.js (bundled in `public/vendor`) with PBR materials, a physically-based sky, image-based lighting,
ACES tone mapping, soft shadows, bloom and fog. Node + `ws` relays co-op traffic; the first player in
a room is the host and runs enemy AI.
