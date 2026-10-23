# FantasyQuest

A 2D retro 16-bit RPG built for the browser. The hero sets out from the shadow of
the Old Forest to recover the lost Relic Crystal, battling woodland creatures,
leveling up, and uncovering the story one dialogue box at a time.

This repository is the scaffold baseline: a retro dark-theme launcher with a
crisp 16:9 (800x450) pixelated canvas, a CRT scanline toggle, and an intro
screen showing the title, the hero portrait in a dialogue box, and the
`forest_battle.png` backdrop.

## Getting Started

Open `index.html` directly in a browser, or serve the folder locally:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

Controls:

- On the title screen, click / tap or press `Space` / `Enter` to enter the battle arena (Pass 1).
- In battle, click the command buttons: `ATTACK` (then click a glowing enemy to target it), `MAGIC` (10 MP, hits all enemies), `ITEM` (use the Arcane Crystal to heal 50 HP, once per battle), `DEFEND` (halve incoming damage for one enemy turn).
- Winning a battle awards EXP and Gold (Phase 9/10). Leveling up raises MaxHP (+5) and Attack (+2) and fully heals the hero. Level, EXP, and Gold persist across battles and are shown in the hero HUD.
- Click the `CRT: ON` button or press `S` to toggle the CRT scanline effect.

## Project Structure

```
FantasyQuest/
├── index.html                 Retro launcher + intro + battle scenes
├── styles.css                 Retro layout, dialogue box, CRT scanlines
├── audio.js                   Web Audio 16-bit SFX synthesizer
├── progression.js             EXP & leveling module (Phase 9)
├── battle.js                  Turn-based battle engine (Pass 1 + Phase 9/10 rewards)
├── assets/
│   ├── backgrounds/           Battle and scene backdrops
│   ├── portraits/             Character dialogue portraits
│   ├── sprites/               Enemy battle sprites (player and map tiles planned)
│   ├── items/                 Item and relic icons
│   ├── audio/                 Music and sound effects
│   └── ui/                    UI elements (frames, cursors, icons)
├── ROADMAP.md                 Development roadmap
└── README.md                  This file
```

## Asset Manifest Table

### Active assets

| Filename | Folder | Dimensions | Transparency | Description |
| --- | --- | --- | --- | --- |
| forest_battle.png | assets/backgrounds/ | 1376x768 | No | Forest battle backdrop used on the intro screen |
| hero_neutral.png | assets/portraits/ | 1376x768 | No | Hero portrait shown in the dialogue box |
| hero_battle.png | assets/portraits/ | 1376x768 | No | Hero battle portrait for combat scenes |
| relic_crystal.png | assets/items/ | 1024x1024 | No | The Relic Crystal quest item icon |
| goblin_battle.png | assets/sprites/ | 32x32 | Yes | Forest Goblin battle sprite (placeholder pixel art) |
| wolf_battle.png | assets/sprites/ | 32x32 | Yes | Shadow Wolf battle sprite (placeholder pixel art) |

### Planned assets

| Filename | Folder | Dimensions | Transparency | Description |
| --- | --- | --- | --- | --- |
| hero_walk_sheet.png | assets/sprites/ | 256x256 | Yes | Four-direction walk cycle spritesheet for the hero |
| slime_sprite.png | assets/sprites/ | 64x64 | Yes | Forest slime enemy battle sprite |
| village_battle.png | assets/backgrounds/ | 1376x768 | No | Village battle backdrop |
| cave_battle.png | assets/backgrounds/ | 1376x768 | No | Cave battle backdrop |
| potion_red.png | assets/items/ | 128x128 | Yes | Healing potion item icon |
| sword_iron.png | assets/items/ | 128x128 | Yes | Starting weapon item icon |
| overworld_theme.mp3 | assets/audio/ | n/a | n/a | Overworld exploration music loop |
| battle_theme.mp3 | assets/audio/ | n/a | n/a | Battle encounter music loop |
| cursor_retro.png | assets/ui/ | 32x32 | Yes | Retro menu selection cursor |

## Notes

- `assets/sprites/` holds enemy battle sprites wired into the battle scene by
  `battle.js`. They render with `image-rendering: pixelated` at 32x32 source
  resolution; if a sprite file fails to load, the styled silhouette fallback art
  is shown instead so the battle never breaks. The two current sprites are
  local placeholder stand-ins to be replaced with hand-drawn pixel art later.
- The generated artwork was delivered as JPEG data with `.png` filenames; the
  four active assets were re-encoded as true PNGs on import, so the extensions
  now match the actual format. None of them carry an alpha channel; UI cutouts
  should rely on the CSS frames instead of image transparency.
