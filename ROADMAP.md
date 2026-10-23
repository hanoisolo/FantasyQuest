RPG Development Roadmap Phases

Phase 9: Experience and Leveling [DONE]



Implement an EXP drop for the monster upon defeat. (Each enemy in battle.js CONFIG carries expReward; awarded on victory.)



Track player EXP and set thresholds for level-ups. (progression.js: LEVEL_THRESHOLDS [0,20,50,100,180,300,480]; HUD shows LV + EXP.)



Automatically increase MaxHP and AttackPower when a level threshold is reached. (+5 MaxHP, +2 attackDamage per level; full heal on level-up.)



Phase 10: Currency and Loot [DONE]



Add a Gold (G) drop to monsters. (Each enemy carries goldReward; HUD shows current gold.)



Track Gold in the player's inventory object. (Hero profile persists gold across battles.)



Phase 11: NPCs and Dialogue



Create non-hostile entities on the map (e.g., blue squares).



Implement an interaction mechanic: walking into an NPC triggers a text box at the bottom of the screen instead of a battle.



Phase 12: Shop System



Combine NPCs and Currency. Create a specific "Merchant" NPC.



Interacting with the Merchant opens a 'SHOP' state where the player can exchange Gold for Potions.



Phase 13: Multiple Map Support (Zone Transitions)



Add logic to load different 2D arrays (e.g., swapping from the Overworld map to a Town map or Dungeon map).



Create "warp tiles" (e.g., yellow squares) that trigger the map swap and reposition the player to a new starting coordinate.



Phase 14: Advanced Combat Mechanics [DONE]

Status note: MP, the MAGIC command, and multi-enemy targeting already shipped in the master battle engine (battle.js).



Add a Magic Points (MP) stat.



Introduce a 'Spell' or 'Skill' menu option in combat that consumes MP to deal higher damage than a standard attack.



Add multiple enemy support, requiring the player to select a target before attacking.



Phase 15: Save and Load System



Use the browser's localStorage API.



Create a mechanism to write the Player's object (Stats, Inventory, Map coordinates, Current Map) to local storage.



Add a 'Load Game' option to the initial boot screen.



Phase 16: Visual Polish (Sprite Integration) [PARTIAL]

Status note: enemy battle sprites (goblin_battle.png, wolf_battle.png) are integrated into the battle scene with a silhouette fallback. Player and map tile sprites are deferred until the overworld exists.



Replace the colored canvas rectangles with actual 16x16 pixel art sprites (.png files) for the player, map tiles, and monsters.



Phase 17: Audio Integration [DONE]

Status note: audio.js already covers attack and menu SFX via the Web Audio synthesizer (slash, cursor beep, magic sparkle, heal chime, victory fanfare, defeat sting).



Use the HTML5 Audio API to trigger sound effects (SFX) for attacks and menu selections.



Add looping background music (BGM) for the Overworld and Combat states.

