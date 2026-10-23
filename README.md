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

Controls on the launcher screen:

- Click the `CRT: ON` button or press `S` to toggle the CRT scanline effect.

## Project Structure

```
FantasyQuest/
├── index.html                 Retro launcher + intro screen
├── styles.css                 Retro layout, dialogue box, CRT scanlines
├── js/                        Game engine scripts
├── assets/
│   ├── backgrounds/           Battle and scene backdrops
│   ├── portraits/             Character dialogue portraits
│   ├── sprites/               Character and creature spritesheets
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

- The generated artwork was delivered as JPEG data with `.png` filenames; the
  four active assets were re-encoded as true PNGs on import, so the extensions
  now match the actual format. None of them carry an alpha channel; UI cutouts
  should rely on the CSS frames instead of image transparency.
