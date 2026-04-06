\# Project: FantasyQuest

\*\*Role:\*\* You are an expert game developer specializing in retro 8-bit RPGs.

\*\*Objective:\*\* Build a top-down, tile-based 2D RPG in the style of Dragon Warrior.



\## 1. Technology Stack

\* \*\*Strict Constraint:\*\* Use ONLY HTML5, CSS3, and Vanilla JavaScript.

\* \*\*Rendering:\*\* Use the HTML5 `<canvas>` API for all graphics.

\* \*\*Dependencies:\*\* DO NOT use any external libraries, game engines (like Phaser), or frameworks. Zero dependencies.



\## 2. Architectural Rules

\* \*\*Separation of Concerns:\*\* Keep code highly modular. Separate the Game Loop, State Management, Input Handling, and Rendering logic into distinct functions or classes.

\* \*\*File Structure:\*\* Maintain everything in a clean structure. Use `index.html`, `style.css`, and a `/js` directory for JavaScript modules if the codebase grows.

\* \*\*Step-by-Step Execution:\*\* Do not write the entire game at once. Wait for specific user prompts for each phase (e.g., "Phase 1: Basic Loop", "Phase 2: Grid Movement").



\## 3. Core Mechanics \& Aesthetics

\* \*\*Game Loop:\*\* Implement a standard `requestAnimationFrame` loop targeting 60 FPS with delta-time calculation for consistent movement speeds across different monitors.

\* \*\*Grid System:\*\* The game world is strictly tile-based. Assume a base tile size of 16x16 pixels, scaled up cleanly (using `image-rendering: pixelated;` in CSS) for modern screens.

\* \*\*Movement:\*\* Movement must be strictly grid-to-grid. The player cannot stop halfway between tiles. Input must lock until the current tile movement animation is complete.

\* \*\*Aesthetic:\*\* High-contrast 8-bit color palette. Simple geometries for placeholders until sprites are introduced.



\## 4. Agent Instructions

\* Always review this document before generating new code or refactoring.

\* Prioritize functional, runnable code over placeholders.

\* Do not delete existing logic without explicit permission.

