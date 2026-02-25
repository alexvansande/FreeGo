# Contributing to FreeGo

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/alexvansande/FreeGo.git
   cd FreeGo
   npm install
   ```

2. Run the game: Open `index.html` in a browser, or serve it:
   ```bash
   python -m http.server 8000
   ```
   Then visit http://localhost:8000

## How to Contribute

- **Bug reports:** Open an issue describing the bug, steps to reproduce, and your environment.
- **Feature ideas:** Open an issue to discuss before implementing.
- **Code changes:** Fork, branch, make your changes, and open a pull request.

## Pull Request Process

1. Create a branch from `main` for your change.
2. Keep changes focused—one logical change per PR.
3. Test that the game still runs and behaves as expected.
4. Open a PR with a clear description of what changed and why.

## Code Style

- The project is a single-file HTML game with minimal external dependencies.
- Keep the code readable; prefer clarity over cleverness.
- See `CLAUDE.md` for architecture notes.
