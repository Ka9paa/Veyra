import os
import json
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

TOKEN=(os.getenv("DISCORD_BOT_TOKEN") or "").strip()
DATABASE_URL=(os.getenv("DATABASE_URL") or "").strip()
GUILD_ID=(os.getenv("DISCORD_GUILD_ID") or "").strip()
ADMIN_IDS={int(x.strip()) for x in (os.getenv("DISCORD_ADMIN_USER_IDS") or "").split(",") if x.strip().isdigit()}

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL="postgresql://"+DATABASE_URL[len("postgres://"):]

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def connect():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required for the Discord admin bot.")
    import psycopg
    from psycopg.rows import dict_row
    return psycopg.connect(DATABASE_URL,row_factory=dict_row)

def admin_only(interaction:discord.Interaction)->bool:
    return interaction.user.id in ADMIN_IDS

async def reject(interaction):
    await interaction.response.send_message("You are not authorized to use Veyra admin commands.",ephemeral=True)

def find_user(cur,query):
    q=query.strip()
    if q.isdigit():
        row=cur.execute("SELECT * FROM users WHERE id=%s",(int(q),)).fetchone()
        if row:return row
    return cur.execute("SELECT * FROM users WHERE LOWER(email)=LOWER(%s)",(q,)).fetchone()

def audit(cur,action,target_id,details,discord_id):
    payload={"source":"discord","discord_admin_id":discord_id,**details}
    cur.execute(
        "INSERT INTO admin_audit(admin_user_id,action,target_type,target_id,details,created_at) VALUES(NULL,%s,'user',%s,%s,%s)",
        (action,target_id,json.dumps(payload),now())
    )

intents=discord.Intents.none()
bot=commands.Bot(command_prefix="!",intents=intents)

@bot.event
async def on_ready():
    try:
        if GUILD_ID.isdigit():
            guild=discord.Object(id=int(GUILD_ID))
            bot.tree.copy_global_to(guild=guild)
            synced=await bot.tree.sync(guild=guild)
        else:
            synced=await bot.tree.sync()
        print(f"Veyra admin bot ready as {bot.user} | synced {len(synced)} commands")
    except Exception as exc:
        print("Command sync failed:",exc)

@bot.tree.command(name="addcredits",description="Add Veyra credits to a user.")
@app_commands.describe(user="Veyra email or numeric user ID",amount="Credits to add")
async def addcredits(interaction:discord.Interaction,user:str,amount:app_commands.Range[int,1,1000000]):
    if not admin_only(interaction):return await reject(interaction)
    with connect() as conn:
        with conn.cursor() as cur:
            row=find_user(cur,user)
            if not row:return await interaction.response.send_message("User not found.",ephemeral=True)
            new=int(row["credits"])+int(amount)
            cur.execute("UPDATE users SET credits=%s WHERE id=%s",(new,row["id"]))
            audit(cur,"discord_add_credits",row["id"],{"amount":int(amount),"before":int(row["credits"]),"after":new},interaction.user.id)
        conn.commit()
    await interaction.response.send_message(f"Added **{amount:,}** credits. New balance: **{new:,}**.",ephemeral=True)

@bot.tree.command(name="removecredits",description="Remove Veyra credits from a user.")
async def removecredits(interaction:discord.Interaction,user:str,amount:app_commands.Range[int,1,1000000]):
    if not admin_only(interaction):return await reject(interaction)
    with connect() as conn:
        with conn.cursor() as cur:
            row=find_user(cur,user)
            if not row:return await interaction.response.send_message("User not found.",ephemeral=True)
            new=max(0,int(row["credits"])-int(amount))
            cur.execute("UPDATE users SET credits=%s WHERE id=%s",(new,row["id"]))
            audit(cur,"discord_remove_credits",row["id"],{"amount":int(amount),"before":int(row["credits"]),"after":new},interaction.user.id)
        conn.commit()
    await interaction.response.send_message(f"Removed **{amount:,}** credits. New balance: **{new:,}**.",ephemeral=True)

@bot.tree.command(name="setcredits",description="Set a user's Veyra credit balance.")
async def setcredits(interaction:discord.Interaction,user:str,amount:app_commands.Range[int,0,10000000]):
    if not admin_only(interaction):return await reject(interaction)
    with connect() as conn:
        with conn.cursor() as cur:
            row=find_user(cur,user)
            if not row:return await interaction.response.send_message("User not found.",ephemeral=True)
            cur.execute("UPDATE users SET credits=%s WHERE id=%s",(int(amount),row["id"]))
            audit(cur,"discord_set_credits",row["id"],{"before":int(row["credits"]),"after":int(amount)},interaction.user.id)
        conn.commit()
    await interaction.response.send_message(f"Balance set to **{amount:,}** credits.",ephemeral=True)

@bot.tree.command(name="setplan",description="Set a user's Veyra plan.")
@app_commands.choices(plan=[
    app_commands.Choice(name="Free",value="free"),
    app_commands.Choice(name="Pro",value="pro"),
    app_commands.Choice(name="Max",value="max"),
])
async def setplan(interaction:discord.Interaction,user:str,plan:app_commands.Choice[str]):
    if not admin_only(interaction):return await reject(interaction)
    with connect() as conn:
        with conn.cursor() as cur:
            row=find_user(cur,user)
            if not row:return await interaction.response.send_message("User not found.",ephemeral=True)
            cur.execute("UPDATE users SET plan=%s WHERE id=%s",(plan.value,row["id"]))
            audit(cur,"discord_set_plan",row["id"],{"before":row.get("plan"),"after":plan.value},interaction.user.id)
        conn.commit()
    await interaction.response.send_message(f"Plan changed to **{plan.name}**.",ephemeral=True)

@bot.tree.command(name="blacklist",description="Restrict a Veyra account.")
@app_commands.describe(user="Veyra email or numeric user ID",reason="Why the account is being restricted")
async def blacklist(interaction:discord.Interaction,user:str,reason:str):
    if not admin_only(interaction):return await reject(interaction)
    reason=reason.strip()[:300] or "Administrative action"
    with connect() as conn:
        with conn.cursor() as cur:
            row=find_user(cur,user)
            if not row:return await interaction.response.send_message("User not found.",ephemeral=True)
            cur.execute("UPDATE users SET is_blacklisted=1,blacklist_reason=%s WHERE id=%s",(reason,row["id"]))
            audit(cur,"discord_blacklist",row["id"],{"reason":reason},interaction.user.id)
        conn.commit()
    await interaction.response.send_message(f"Restricted **{row.get('email') or row.get('name')}**.",ephemeral=True)

@bot.tree.command(name="unblacklist",description="Remove a Veyra account restriction.")
async def unblacklist(interaction:discord.Interaction,user:str):
    if not admin_only(interaction):return await reject(interaction)
    with connect() as conn:
        with conn.cursor() as cur:
            row=find_user(cur,user)
            if not row:return await interaction.response.send_message("User not found.",ephemeral=True)
            cur.execute("UPDATE users SET is_blacklisted=0,blacklist_reason='' WHERE id=%s",(row["id"],))
            audit(cur,"discord_unblacklist",row["id"],{},interaction.user.id)
        conn.commit()
    await interaction.response.send_message("Account restriction removed.",ephemeral=True)

@bot.tree.command(name="veyrauser",description="Look up a Veyra user.")
async def veyrauser(interaction:discord.Interaction,user:str):
    if not admin_only(interaction):return await reject(interaction)
    with connect() as conn:
        with conn.cursor() as cur:
            row=find_user(cur,user)
    if not row:return await interaction.response.send_message("User not found.",ephemeral=True)
    embed=discord.Embed(title=row.get("name") or "Veyra User",color=0x7457E8)
    embed.add_field(name="Email",value=row.get("email") or "None",inline=False)
    embed.add_field(name="ID",value=str(row["id"]))
    embed.add_field(name="Plan",value=(row.get("plan") or "free").upper())
    embed.add_field(name="Credits",value=f"{int(row.get('credits') or 0):,}")
    embed.add_field(name="Provider",value=(row.get("provider") or "unknown").title())
    embed.add_field(name="Restricted",value="Yes" if int(row.get("is_blacklisted") or 0) else "No")
    await interaction.response.send_message(embed=embed,ephemeral=True)

if __name__=="__main__":
    if not TOKEN:raise RuntimeError("DISCORD_BOT_TOKEN is missing.")
    if not ADMIN_IDS:raise RuntimeError("DISCORD_ADMIN_USER_IDS is missing.")
    bot.run(TOKEN)
