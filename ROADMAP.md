RPG Development Roadmap Phases

Phase 9: Experience and Leveling



Implement an EXP drop for the monster upon defeat.



Track player EXP and set thresholds for level-ups.



Automatically increase MaxHP and AttackPower when a level threshold is reached.



Phase 10: Currency and Loot



Add a Gold (G) drop to monsters.



Track Gold in the player's inventory object.



Phase 11: NPCs and Dialogue



Create non-hostile entities on the map (e.g., blue squares).



Implement an interaction mechanic: walking into an NPC triggers a text box at the bottom of the screen instead of a battle.



Phase 12: Shop System



Combine NPCs and Currency. Create a specific "Merchant" NPC.



Interacting with the Merchant opens a 'SHOP' state where the player can exchange Gold for Potions.



Phase 13: Multiple Map Support (Zone Transitions)



Add logic to load different 2D arrays (e.g., swapping from the Overworld map to a Town map or Dungeon map).



Create "warp tiles" (e.g., yellow squares) that trigger the map swap and reposition the player to a new starting coordinate.



Phase 14: Advanced Combat Mechanics



Add a Magic Points (MP) stat.



Introduce a 'Spell' or 'Skill' menu option in combat that consumes MP to deal higher damage than a standard attack.



Add multiple enemy support, requiring the player to select a target before attacking.



Phase 15: Save and Load System



Use the browser's localStorage API.



Create a mechanism to write the Player's object (Stats, Inventory, Map coordinates, Current Map) to local storage.



Add a 'Load Game' option to the initial boot screen.



Phase 16: Visual Polish (Sprite Integration)



Replace the colored canvas rectangles with actual 16x16 pixel art sprites (.png files) for the player, map tiles, and monsters.



Phase 17: Audio Integration



Use the HTML5 Audio API to trigger sound effects (SFX) for attacks and menu selections.



Add looping background music (BGM) for the Overworld and Combat states.

