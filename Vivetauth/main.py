import os
import json
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

# Always load .env from this bot's own folder.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

TOKEN = (os.getenv("DISCORD_BOT_TOKEN") or "").strip()
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
GUILD_ID = (os.getenv("DISCORD_GUILD_ID") or "").strip()

# Only these Discord accounts can use owner-level Veyra admin commands.
ADMIN_IDS = {
    int(x.strip())
    for x in (os.getenv("DISCORD_ADMIN_USER_IDS") or "").split(",")
    if x.strip().isdigit()
}

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required for the Discord admin bot.")

    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def ensure_schema():
    """Create the shared Discord-admin table if it does not exist."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS site_admins(
                    discord_id TEXT PRIMARY KEY,
                    discord_username TEXT,
                    granted_by TEXT NOT NULL,
                    granted_at TEXT NOT NULL
                )
                """
            )
        conn.commit()


def admin_only(interaction: discord.Interaction) -> bool:
    return interaction.user.id in ADMIN_IDS


async def reject(interaction: discord.Interaction):
    await interaction.response.send_message(
        "You are not authorized to use Veyra owner commands.",
        ephemeral=True,
    )


def display_name(user: discord.abc.User):
    return getattr(user, "display_name", None) or getattr(user, "name", None) or str(user.id)


def find_veyra_user_by_discord(cur, discord_user_id: int):
    """
    Website accounts signed in with Discord store:
      provider='discord'
      provider_user_id='<discord id>'

    This means every slash command can use @user instead of typing
    emails or Veyra IDs.
    """
    return cur.execute(
        """
        SELECT *
        FROM users
        WHERE discord_id=%s
           OR (LOWER(provider)='discord' AND provider_user_id=%s)
        ORDER BY CASE WHEN discord_id=%s THEN 0 ELSE 1 END, id ASC
        LIMIT 1
        """,
        (
            str(discord_user_id),
            str(discord_user_id),
            str(discord_user_id),
        ),
    ).fetchone()


def audit(cur, action, target_id, details, discord_id):
    payload = {
        "source": "discord",
        "discord_admin_id": str(discord_id),
        **details,
    }

    cur.execute(
        """
        INSERT INTO admin_audit(
            admin_user_id,
            action,
            target_type,
            target_id,
            details,
            created_at
        )
        VALUES(NULL,%s,'user',%s,%s,%s)
        """,
        (
            action,
            target_id,
            json.dumps(payload),
            now(),
        ),
    )


async def missing_veyra_account(interaction: discord.Interaction, user: discord.Member):
    await interaction.response.send_message(
        f"{user.mention} is not linked to a Veyra Discord account yet.\n"
        "Have them sign in to Veyra with **Discord** once, then run the command again.",
        ephemeral=True,
    )


intents = discord.Intents.none()
bot = commands.Bot(command_prefix="!", intents=intents)


@bot.event
async def on_ready():
    try:
        ensure_schema()

        if GUILD_ID.isdigit():
            guild = discord.Object(id=int(GUILD_ID))
            bot.tree.copy_global_to(guild=guild)
            synced = await bot.tree.sync(guild=guild)
        else:
            synced = await bot.tree.sync()

        print(
            f"Veyra admin bot ready as {bot.user} | "
            f"synced {len(synced)} commands"
        )

    except Exception as exc:
        print("Command sync failed:", exc)


# ------------------------------------------------------------------
# WEBSITE ADMIN ACCESS
# ------------------------------------------------------------------

@bot.tree.command(
    name="giveadmin",
    description="Give a Discord user access to the Veyra website admin panel.",
)
@app_commands.describe(user="Select the Discord user to make a Veyra website admin")
@app_commands.guild_only()
async def giveadmin(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO site_admins(
                    discord_id,
                    discord_username,
                    granted_by,
                    granted_at
                )
                VALUES(%s,%s,%s,%s)
                ON CONFLICT(discord_id)
                DO UPDATE SET
                    discord_username=EXCLUDED.discord_username,
                    granted_by=EXCLUDED.granted_by,
                    granted_at=EXCLUDED.granted_at
                """,
                (
                    str(user.id),
                    str(user),
                    str(interaction.user.id),
                    now(),
                ),
            )

            linked = find_veyra_user_by_discord(cur, user.id)
            if linked:
                audit(
                    cur,
                    "discord_give_site_admin",
                    linked["id"],
                    {
                        "target_discord_id": str(user.id),
                        "target_discord_username": str(user),
                    },
                    interaction.user.id,
                )

        conn.commit()

    embed = discord.Embed(
        title="Veyra Admin Granted",
        description=f"{user.mention} can now access the Veyra admin panel after signing in with Discord.",
        color=0x7457E8,
    )
    embed.add_field(name="Discord ID", value=f"`{user.id}`", inline=True)
    embed.add_field(
        name="Website account",
        value="Linked" if linked else "Not linked yet",
        inline=True,
    )
    embed.set_footer(text="Veyra Administration")

    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(
    name="removeadmin",
    description="Remove a Discord user's Veyra website admin access.",
)
@app_commands.describe(user="Select the Discord user to remove from Veyra website admins")
@app_commands.guild_only()
async def removeadmin(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM site_admins WHERE discord_id=%s",
                (str(user.id),),
            )
            removed = cur.rowcount > 0

            linked = find_veyra_user_by_discord(cur, user.id)
            if linked:
                audit(
                    cur,
                    "discord_remove_site_admin",
                    linked["id"],
                    {
                        "target_discord_id": str(user.id),
                        "target_discord_username": str(user),
                    },
                    interaction.user.id,
                )

        conn.commit()

    await interaction.response.send_message(
        (
            f"Removed Veyra website admin access from {user.mention}."
            if removed
            else f"{user.mention} was not in the Veyra website admin list."
        ),
        ephemeral=True,
    )


@bot.tree.command(
    name="admininfo",
    description="Check whether a Discord user has Veyra website admin access.",
)
@app_commands.describe(user="Select a Discord user")
@app_commands.guild_only()
async def admininfo(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            admin_row = cur.execute(
                "SELECT * FROM site_admins WHERE discord_id=%s",
                (str(user.id),),
            ).fetchone()
            linked = find_veyra_user_by_discord(cur, user.id)

    embed = discord.Embed(
        title="Veyra Admin Information",
        color=0x7457E8 if admin_row else 0x2B2D31,
    )
    embed.add_field(name="Discord user", value=user.mention, inline=False)
    embed.add_field(
        name="Website admin",
        value="Yes" if admin_row else "No",
        inline=True,
    )
    embed.add_field(
        name="Veyra account linked",
        value="Yes" if linked else "No",
        inline=True,
    )

    if linked:
        embed.add_field(
            name="Plan",
            value=(linked.get("plan") or "free").upper(),
            inline=True,
        )
        embed.add_field(
            name="Credits",
            value=f"{int(linked.get('credits') or 0):,}",
            inline=True,
        )

    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(
    name="listadmins",
    description="List Discord users with Veyra website admin access.",
)
async def listadmins(interaction: discord.Interaction):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            rows = cur.execute(
                """
                SELECT *
                FROM site_admins
                ORDER BY granted_at DESC
                LIMIT 50
                """
            ).fetchall()

    if not rows:
        return await interaction.response.send_message(
            "No Discord users currently have Veyra website admin access.",
            ephemeral=True,
        )

    lines = []
    for row in rows:
        did = row["discord_id"]
        lines.append(
            f"<@{did}> — `{did}`"
        )

    embed = discord.Embed(
        title="Veyra Website Admins",
        description="\n".join(lines),
        color=0x7457E8,
    )
    embed.set_footer(text=f"{len(rows)} admin(s)")

    await interaction.response.send_message(embed=embed, ephemeral=True)


# ------------------------------------------------------------------
# ACCOUNT / CREDIT / PLAN COMMANDS
# These now use a real @user selector.
# ------------------------------------------------------------------

@bot.tree.command(
    name="addcredits",
    description="Add Veyra credits to a Discord-linked Veyra user.",
)
@app_commands.describe(
    user="Select the Discord user",
    amount="Credits to add",
)
@app_commands.guild_only()
async def addcredits(
    interaction: discord.Interaction,
    user: discord.Member,
    amount: app_commands.Range[int, 1, 1000000],
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)

            if not row:
                return await missing_veyra_account(interaction, user)

            before = int(row.get("credits") or 0)
            new = before + int(amount)

            cur.execute(
                "UPDATE users SET credits=%s WHERE id=%s",
                (new, row["id"]),
            )

            audit(
                cur,
                "discord_add_credits",
                row["id"],
                {
                    "amount": int(amount),
                    "before": before,
                    "after": new,
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"Added **{amount:,}** credits to {user.mention}. New balance: **{new:,}**.",
        ephemeral=True,
    )


@bot.tree.command(
    name="removecredits",
    description="Remove Veyra credits from a Discord-linked Veyra user.",
)
@app_commands.describe(
    user="Select the Discord user",
    amount="Credits to remove",
)
@app_commands.guild_only()
async def removecredits(
    interaction: discord.Interaction,
    user: discord.Member,
    amount: app_commands.Range[int, 1, 1000000],
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)

            if not row:
                return await missing_veyra_account(interaction, user)

            before = int(row.get("credits") or 0)
            new = max(0, before - int(amount))

            cur.execute(
                "UPDATE users SET credits=%s WHERE id=%s",
                (new, row["id"]),
            )

            audit(
                cur,
                "discord_remove_credits",
                row["id"],
                {
                    "amount": int(amount),
                    "before": before,
                    "after": new,
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"Removed **{amount:,}** credits from {user.mention}. New balance: **{new:,}**.",
        ephemeral=True,
    )


@bot.tree.command(
    name="setcredits",
    description="Set a Discord-linked user's Veyra credit balance.",
)
@app_commands.describe(
    user="Select the Discord user",
    amount="New credit balance",
)
@app_commands.guild_only()
async def setcredits(
    interaction: discord.Interaction,
    user: discord.Member,
    amount: app_commands.Range[int, 0, 10000000],
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)

            if not row:
                return await missing_veyra_account(interaction, user)

            before = int(row.get("credits") or 0)

            cur.execute(
                "UPDATE users SET credits=%s WHERE id=%s",
                (int(amount), row["id"]),
            )

            audit(
                cur,
                "discord_set_credits",
                row["id"],
                {
                    "before": before,
                    "after": int(amount),
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"Set {user.mention}'s balance to **{amount:,}** credits.",
        ephemeral=True,
    )


@bot.tree.command(
    name="setplan",
    description="Set a Discord-linked user's Veyra plan.",
)
@app_commands.describe(user="Select the Discord user")
@app_commands.choices(
    plan=[
        app_commands.Choice(name="Free", value="free"),
        app_commands.Choice(name="Pro", value="pro"),
        app_commands.Choice(name="Max", value="max"),
    ]
)
@app_commands.guild_only()
async def setplan(
    interaction: discord.Interaction,
    user: discord.Member,
    plan: app_commands.Choice[str],
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)

            if not row:
                return await missing_veyra_account(interaction, user)

            before = row.get("plan") or "free"

            cur.execute(
                "UPDATE users SET plan=%s WHERE id=%s",
                (plan.value, row["id"]),
            )

            audit(
                cur,
                "discord_set_plan",
                row["id"],
                {
                    "before": before,
                    "after": plan.value,
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"Changed {user.mention}'s Veyra plan to **{plan.name}**.",
        ephemeral=True,
    )


@bot.tree.command(
    name="blacklist",
    description="Restrict a Discord-linked Veyra account.",
)
@app_commands.describe(
    user="Select the Discord user",
    reason="Why the account is being restricted",
)
@app_commands.guild_only()
async def blacklist(
    interaction: discord.Interaction,
    user: discord.Member,
    reason: str,
):
    if not admin_only(interaction):
        return await reject(interaction)

    reason = reason.strip()[:300] or "Administrative action"

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)

            if not row:
                return await missing_veyra_account(interaction, user)

            cur.execute(
                """
                UPDATE users
                SET is_blacklisted=1,
                    blacklist_reason=%s
                WHERE id=%s
                """,
                (reason, row["id"]),
            )

            audit(
                cur,
                "discord_blacklist",
                row["id"],
                {
                    "reason": reason,
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"Restricted {user.mention}.\n**Reason:** {reason}",
        ephemeral=True,
    )


@bot.tree.command(
    name="unblacklist",
    description="Remove a Discord-linked Veyra account restriction.",
)
@app_commands.describe(user="Select the Discord user")
@app_commands.guild_only()
async def unblacklist(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)

            if not row:
                return await missing_veyra_account(interaction, user)

            cur.execute(
                """
                UPDATE users
                SET is_blacklisted=0,
                    blacklist_reason=''
                WHERE id=%s
                """,
                (row["id"],),
            )

            audit(
                cur,
                "discord_unblacklist",
                row["id"],
                {
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"Removed the Veyra account restriction from {user.mention}.",
        ephemeral=True,
    )


@bot.tree.command(
    name="veyrauser",
    description="View a Discord-linked Veyra account.",
)
@app_commands.describe(user="Select the Discord user")
@app_commands.guild_only()
async def veyrauser(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)
            website_admin = cur.execute(
                "SELECT 1 FROM site_admins WHERE discord_id=%s",
                (str(user.id),),
            ).fetchone()

    if not row:
        return await missing_veyra_account(interaction, user)

    embed = discord.Embed(
        title=row.get("name") or display_name(user),
        description=user.mention,
        color=0x7457E8,
    )

    if user.display_avatar:
        embed.set_thumbnail(url=user.display_avatar.url)

    embed.add_field(
        name="Email",
        value=row.get("email") or "None",
        inline=False,
    )
    embed.add_field(name="Veyra ID", value=str(row["id"]))
    embed.add_field(name="Discord ID", value=str(user.id))
    embed.add_field(
        name="Plan",
        value=(row.get("plan") or "free").upper(),
    )
    embed.add_field(
        name="Credits",
        value=f"{int(row.get('credits') or 0):,}",
    )
    embed.add_field(
        name="Website Admin",
        value="Yes" if website_admin else "No",
    )
    embed.add_field(
        name="Restricted",
        value="Yes" if int(row.get("is_blacklisted") or 0) else "No",
    )

    await interaction.response.send_message(
        embed=embed,
        ephemeral=True,
    )


# ------------------------------------------------------------------
# CONVENIENCE / OWNER COMMANDS
# These also use Discord's native member selector, not typed usernames.
# ------------------------------------------------------------------

@bot.tree.command(
    name="admin",
    description="Give a Discord member Veyra website admin access.",
)
@app_commands.guild_only()
@app_commands.describe(user="Pick a server member")
async def admin_alias(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO site_admins(
                    discord_id,
                    discord_username,
                    granted_by,
                    granted_at
                )
                VALUES(%s,%s,%s,%s)
                ON CONFLICT(discord_id)
                DO UPDATE SET
                    discord_username=EXCLUDED.discord_username,
                    granted_by=EXCLUDED.granted_by,
                    granted_at=EXCLUDED.granted_at
                """,
                (
                    str(user.id),
                    str(user),
                    str(interaction.user.id),
                    now(),
                ),
            )

            linked = find_veyra_user_by_discord(cur, user.id)
            if linked:
                audit(
                    cur,
                    "discord_give_site_admin",
                    linked["id"],
                    {
                        "target_discord_id": str(user.id),
                        "target_discord_username": str(user),
                    },
                    interaction.user.id,
                )

        conn.commit()

    await interaction.response.send_message(
        f"✅ {user.mention} now has **Veyra website admin** access.",
        ephemeral=True,
    )


@bot.tree.command(
    name="unadmin",
    description="Remove a Discord member's Veyra website admin access.",
)
@app_commands.guild_only()
@app_commands.describe(user="Pick a server member")
async def unadmin_alias(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM site_admins WHERE discord_id=%s",
                (str(user.id),),
            )
            removed = cur.rowcount > 0

            linked = find_veyra_user_by_discord(cur, user.id)
            if linked:
                audit(
                    cur,
                    "discord_remove_site_admin",
                    linked["id"],
                    {
                        "target_discord_id": str(user.id),
                        "target_discord_username": str(user),
                    },
                    interaction.user.id,
                )

        conn.commit()

    await interaction.response.send_message(
        (
            f"✅ Removed website admin access from {user.mention}."
            if removed else
            f"ℹ️ {user.mention} was not a website admin."
        ),
        ephemeral=True,
    )


@bot.tree.command(
    name="give",
    description="Give Veyra credits to a server member.",
)
@app_commands.guild_only()
@app_commands.describe(
    user="Pick a server member",
    amount="Credits to give",
)
async def give_alias(
    interaction: discord.Interaction,
    user: discord.Member,
    amount: app_commands.Range[int, 1, 1000000],
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)
            if not row:
                return await missing_veyra_account(interaction, user)

            before = int(row.get("credits") or 0)
            new = before + int(amount)

            cur.execute(
                "UPDATE users SET credits=%s WHERE id=%s",
                (new, row["id"]),
            )

            audit(
                cur,
                "discord_add_credits",
                row["id"],
                {
                    "amount": int(amount),
                    "before": before,
                    "after": new,
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"✅ Gave {user.mention} **{amount:,}** credits.\n"
        f"New balance: **{new:,}**",
        ephemeral=True,
    )


@bot.tree.command(
    name="take",
    description="Take Veyra credits from a server member.",
)
@app_commands.guild_only()
@app_commands.describe(
    user="Pick a server member",
    amount="Credits to remove",
)
async def take_alias(
    interaction: discord.Interaction,
    user: discord.Member,
    amount: app_commands.Range[int, 1, 1000000],
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)
            if not row:
                return await missing_veyra_account(interaction, user)

            before = int(row.get("credits") or 0)
            new = max(0, before - int(amount))

            cur.execute(
                "UPDATE users SET credits=%s WHERE id=%s",
                (new, row["id"]),
            )

            audit(
                cur,
                "discord_remove_credits",
                row["id"],
                {
                    "amount": int(amount),
                    "before": before,
                    "after": new,
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"✅ Removed **{amount:,}** credits from {user.mention}.\n"
        f"New balance: **{new:,}**",
        ephemeral=True,
    )


@bot.tree.command(
    name="resetcredits",
    description="Reset a member's Veyra credits to 0.",
)
@app_commands.guild_only()
@app_commands.describe(user="Pick a server member")
async def resetcredits(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)
            if not row:
                return await missing_veyra_account(interaction, user)

            before = int(row.get("credits") or 0)

            cur.execute(
                "UPDATE users SET credits=0 WHERE id=%s",
                (row["id"],),
            )

            audit(
                cur,
                "discord_reset_credits",
                row["id"],
                {
                    "before": before,
                    "after": 0,
                    "target_discord_id": str(user.id),
                },
                interaction.user.id,
            )

        conn.commit()

    await interaction.response.send_message(
        f"✅ Reset {user.mention}'s credits to **0**.",
        ephemeral=True,
    )


@bot.tree.command(
    name="account",
    description="View a member's linked Veyra account.",
)
@app_commands.guild_only()
@app_commands.describe(user="Pick a server member")
async def account_alias(
    interaction: discord.Interaction,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await reject(interaction)

    with connect() as conn:
        with conn.cursor() as cur:
            row = find_veyra_user_by_discord(cur, user.id)
            website_admin = cur.execute(
                "SELECT 1 FROM site_admins WHERE discord_id=%s",
                (str(user.id),),
            ).fetchone()

    if not row:
        return await missing_veyra_account(interaction, user)

    embed = discord.Embed(
        title="Veyra Account",
        description=user.mention,
        color=0x7457E8,
    )
    embed.set_thumbnail(url=user.display_avatar.url)
    embed.add_field(name="Veyra ID", value=str(row["id"]), inline=True)
    embed.add_field(name="Discord ID", value=str(user.id), inline=True)
    embed.add_field(name="Plan", value=(row.get("plan") or "free").upper(), inline=True)
    embed.add_field(name="Credits", value=f"{int(row.get('credits') or 0):,}", inline=True)
    embed.add_field(name="Website Admin", value="Yes" if website_admin else "No", inline=True)
    embed.add_field(
        name="Restricted",
        value="Yes" if int(row.get("is_blacklisted") or 0) else "No",
        inline=True,
    )
    embed.add_field(name="Email", value=row.get("email") or "None", inline=False)

    await interaction.response.send_message(embed=embed, ephemeral=True)


if __name__ == "__main__":
    if not TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN is missing.")

    if not ADMIN_IDS:
        raise RuntimeError("DISCORD_ADMIN_USER_IDS is missing.")

    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is missing.")

    bot.run(TOKEN)