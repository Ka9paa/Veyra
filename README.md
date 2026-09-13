# Veyra Studio V8

## Run
1. Extract the ZIP.
2. Run `setup.bat`.
3. Put your keys in `.env`.
4. Run `start_veyra.bat`.
5. Open `http://127.0.0.1:8765`.

## Important fixes
- Uses Waitress instead of Flask debug/development server, so the development-server warning is gone.
- Uses timezone-aware UTC timestamps.
- Veyra AI uses Veyra backend internally with the Responses API + strict JSON schema for more reliable generated project output.
- Provider names stay internal; users see Veyra AI.
- If live AI fails, the UI keeps working with a local preview and Settings → Veyra AI Diagnostics shows whether a key is configured.

## Pages
Public: homepage, pricing, login, signup.
Authenticated: Studio, Projects, Templates, Deployments, User Flows, Agents, Automations, Components, Design Tokens, Data Studio, Settings.

## .env
`OPENAI_API_KEY=...`
`VEYRA_MODEL=gpt-5.6-sol`


## V12 UI Polish
- Fixed tiny/misaligned fonts across sidebar and slide pages.
- Increased spacing, card consistency, and button sizing.
- Improved Templates, Projects, Agents, Automations, Data Studio, and Settings layouts.
- Aligned template card text and actions for cleaner visual hierarchy.
