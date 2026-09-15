# DISCORD OAUTH PATCH FOR app.py
# Requires Authlib, same library already used by Google/GitHub in the existing Veyra app.
#
# 1) Near your existing OAuth registrations:
#
# discord_oauth = oauth.register(
#     name="discord",
#     client_id=os.getenv("DISCORD_CLIENT_ID"),
#     client_secret=os.getenv("DISCORD_CLIENT_SECRET"),
#     access_token_url="https://discord.com/api/oauth2/token",
#     authorize_url="https://discord.com/oauth2/authorize",
#     api_base_url="https://discord.com/api/",
#     client_kwargs={"scope": "identify email"},
# )
#
# 2) Add these routes:
#
# @app.route("/auth/discord")
# def auth_discord():
#     if not os.getenv("DISCORD_CLIENT_ID") or not os.getenv("DISCORD_CLIENT_SECRET"):
#         return render_template("oauth_missing.html", provider="Discord"), 503
#     return discord_oauth.authorize_redirect(
#         url_for("discord_callback", _external=True)
#     )
#
# @app.route("/auth/discord/callback")
# def discord_callback():
#     discord_oauth.authorize_access_token()
#     profile = discord_oauth.get("users/@me").json()
#     discord_id = str(profile.get("id") or "")
#     email = profile.get("email")
#     username = profile.get("global_name") or profile.get("username") or "Veyra User"
#     avatar_hash = profile.get("avatar")
#     avatar = (
#         f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png"
#         if discord_id and avatar_hash else None
#     )
#
#     uid = upsert_oauth(
#         "discord",
#         discord_id,
#         email,
#         username,
#         avatar,
#     )
#     session.clear()
#     session["user_id"] = uid
#     return redirect(url_for("dashboard"))
#
# 3) Remove the GitHub buttons from login/signup templates.
#    You may keep the old GitHub backend routes temporarily until you confirm no users
#    rely on them, then remove the GitHub registration/routes separately.
#
# 4) Vercel environment variables:
# DISCORD_CLIENT_ID=...
# DISCORD_CLIENT_SECRET=...
#
# Discord Developer Portal redirect URI:
# https://buildveyra.xyz/auth/discord/callback
# If your canonical production host is www, use that exact host instead.
