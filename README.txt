VEYRA V31 — ADMIN CONTROL CENTER + DISCORD ADMIN BOT

Fixes the giant admin shield and gives Admin its own clean control-center UI.

Admin features:
- user search by name/email/ID
- Free/Pro/Max plan editing
- exact credits + quick +100/+1000
- restrict/unrestrict users with reason
- paid/restricted filters
- admin audit log
- support/vouch summaries
- restricted account screen

Discord slash commands:
- /addcredits
- /removecredits
- /setcredits
- /setplan
- /blacklist
- /unblacklist
- /veyrauser

Discord architecture:
Keep the website on Vercel and Neon. Run discord_admin_bot.py on an always-on Python host
(VPS/PebbleHost/Railway/Render worker). It uses the SAME Neon DATABASE_URL as Veyra.

Bot env vars:
DISCORD_BOT_TOKEN=...
DISCORD_ADMIN_USER_IDS=your_discord_user_id,another_admin_id
DISCORD_GUILD_ID=your_server_id
DATABASE_URL=your Neon connection string

Never put the bot token or DATABASE_URL in GitHub.

Install bot:
pip install -r requirements-bot.txt
python discord_admin_bot.py

This bundle includes the V30 profile/account changes too.
