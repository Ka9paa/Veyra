VEYRA V31.1 — ACCURATE ADMIN AUDIT LOG

The audit log now shows:
- actual target user's name + email instead of only "User #2"
- actual admin actor for web changes
- Discord admin ID for Discord bot changes
- source: Web or Discord
- real credit amount added/removed
- before → after credit balances when available
- plan changes
- blacklist/restriction reason
- exact recorded timestamp

Replace:
app.py
templates/admin_dashboard.html
static/styles.css

This patch is based on V31 and includes the rest of V31 files too.
