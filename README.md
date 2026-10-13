# uebersicht-cava

A responsive desktop audio visualizer widget for [Übersicht](https://tracesof.net/uebersicht/) on macOS, powered by [CAVA](https://github.com/karlstav/cava) and styled with an authentic terminal color theme.

---

## Features

- **Terminal Audio Visualizer**: Renders smooth, real-time frequency spectrum bars directly on your macOS desktop.
- **Gruvbox / iTerm2 Palette**: Uses a smooth multi-stop gradient (`#59cc33` base → `#cccc33` mid → `#cc3333` peak) matching terminal themes.
- **Draggable & Resizable**: Freely drag anywhere on the screen and resize via the corner handle. Position and dimensions persist in `localStorage`.
- **Zero Sockets / EDR-Friendly**: Communicates via local `/tmp` file IPC with automatic heartbeat cleanup. No listening network sockets or background daemons.

---

## Requirements

- [Übersicht](https://tracesof.net/uebersicht/)
- [cava](https://github.com/karlstav/cava):
  ```bash
  brew install cava
  ```

---

## Installation

1. Clone or copy the widget to your Übersicht widgets folder:
   ```bash
   git clone https://github.com/etherlucid/uebersicht-cava.git
   cp -r uebersicht-cava/cava.widget "$HOME/Library/Application Support/Übersicht/widgets/"
   ```

   *Or symlink:*
   ```bash
   ln -s "$(pwd)/uebersicht-cava/cava.widget" "$HOME/Library/Application Support/Übersicht/widgets/cava.widget"
   ```

2. (Optional) Copy `main.css` to `~/Library/Application Support/Übersicht/widgets/main.css` for shared font/backdrop styling.

3. Refresh Übersicht.

---

## Configuration

Customize appearance, bar count, frame rate, and colors in `cava.widget/lib/config.js`.
