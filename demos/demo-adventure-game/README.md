# WordClaw Interactive Adventure Engine

This demo demonstrates how WordClaw can function as a high-safety execution environment, backend storage, and schema enforcer for generative AI applications.

In this web-based "Choose Your Own Adventure" game, an LLM dynamically generates narrative branches as you play, including gamification elements like Health and Score.

## How It Works Under the Hood

The application is built with a Node.js/Express backend (`server.ts`) and a vanilla HTML/CSS/JS frontend (`public/`). It deeply integrates with WordClaw:

1. **Schema Initialization**: On startup, the server automatically connects to WordClaw to verify or create two Content Types:
    - **`StoryNode`**: Defines a single narrative step. It strictly enforces types for `title`, `narrative_text`, `available_choices`, and gamification deltas (`health_delta`, `score_delta`).
    - **`PublishedStory`**: Defines the final compiled story structure for when a player finishes their journey.
2. **AI Safe Generation (The Magic)**: When a player makes a choice, the backend asks the LLM (OpenAI) to generate 3 parallel story branches mapping what happens next. 
3. **Dry-Run Validation**: The backend iterates through the 3 generated branches and asks WordClaw to validate them using `POST /api/content-items?mode=dry_run`. WordClaw enforces the strict `StoryNode` JSON Schema *without mutating the database*. If the LLM hallucinates (e.g., forgets the health delta or provides a string instead of an array of choices), WordClaw rejects it.
4. **State Storage**: The first branch that passes WordClaw's validation is permanently saved as a new content item.
5. **Gamification Engine**: The frontend updates the player's Health and Score dynamically based on the validated LLM outputs.
6. **Story Publishing**: When the game ends naturally or the player's health reaches 0, the entire narrative history is compiled and published as a unified `PublishedStory` item in WordClaw.

## Setup

1. Make sure your WordClaw server is running (`npm run dev` at the repository root).
2. Make sure you have an `.env` file at the repository root containing:
   - `OPENAI_API_KEY=sk-...`
3. Optionally set `WORDCLAW_API_URL` if your API is not running at `http://localhost:4000/api`.

The demo now auto-bootstraps its own local WordClaw domain and API key when `WORDCLAW_API_KEY` is not already set, so it no longer depends on a stale hardcoded key in `package.json`.

## Running the Demo

```bash
cd demos/demo-adventure-game
npm run dev
```

Once the server boots, the game UI will be available in your browser at **`http://localhost:8080`**.

## Compatibility Notes

- the server now preflights WordClaw deployment status before seeding schemas
- schema creation and dry-run validation still happen through the supported API contract
- published stories, theme packs, and character classes continue to use the runtime's published content path
