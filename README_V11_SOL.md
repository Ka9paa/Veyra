# VEYRA STUDIO V11 — GPT-5.6 SOL

V11 switches Veyra's live AI brain to OpenAI GPT-5.6 Sol.

## Setup
1. Run `setup.bat`.
2. Open `.env`.
3. Add your private API key:

OPENAI_API_KEY=your_key_here
VEYRA_MODEL=gpt-5.6-sol

4. Run `start_veyra.bat`.
5. Open http://127.0.0.1:8765

## Important
- Do not share your API key.
- The UI still says Veyra AI; the underlying model stays backend-only.
- If the live API is unavailable, Veyra Local Engine still gives you a preview.
- The local server uses Waitress instead of Flask debug mode.


## V12 UI Polish
- Fixed tiny/misaligned fonts across sidebar and slide pages.
- Increased spacing, card consistency, and button sizing.
- Improved Templates, Projects, Agents, Automations, Data Studio, and Settings layouts.
- Aligned template card text and actions for cleaner visual hierarchy.
