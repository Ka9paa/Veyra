from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app.py"
HTML = ROOT / "templates" / "staff_apply.html"

def fail(msg):
    print(f"[ERROR] {msg}")
    sys.exit(1)

if not APP.exists():
    fail("app.py was not found. Put this script in the root of your Veyra repo.")
if not HTML.exists():
    fail("templates/staff_apply.html was not found.")

app = APP.read_text(encoding="utf-8")
html = HTML.read_text(encoding="utf-8")

# 1) DATABASE: add position without removing any current fields.
app = app.replace(
    "                discord_name TEXT DEFAULT '',\n                age TEXT DEFAULT '',",
    "                discord_name TEXT DEFAULT '',\n                position TEXT DEFAULT '',\n                age TEXT DEFAULT '',",
)

pg_migration = '            c.execute("ALTER TABLE staff_applications ADD COLUMN IF NOT EXISTS discord_name TEXT DEFAULT \'\'")'
if pg_migration in app and "ADD COLUMN IF NOT EXISTS position" not in app:
    app = app.replace(
        pg_migration,
        pg_migration + '\n            c.execute("ALTER TABLE staff_applications ADD COLUMN IF NOT EXISTS position TEXT DEFAULT \'\'")',
        1,
    )

app = app.replace(
    "'discord_name':\"TEXT DEFAULT ''\",'age':\"TEXT DEFAULT ''\",'timezone':\"TEXT DEFAULT ''\",",
    "'discord_name':\"TEXT DEFAULT ''\",'position':\"TEXT DEFAULT ''\",'age':\"TEXT DEFAULT ''\",'timezone':\"TEXT DEFAULT ''\",",
)

# 2) BACKEND: read + validate role.
timezone_line = "        timezone=(request.form.get('timezone') or '').strip()[:80]"
if timezone_line not in app:
    fail("Could not find the staff application POST fields in app.py.")

position_code = '''\n        position=(request.form.get('position') or '').strip()[:80]
        allowed_positions={
            'Outreach & Partnerships',
            'Content & Marketing',
            'Customer Support',
            'Community Manager',
            'QA & Beta Tester',
        }
        if position not in allowed_positions:
            flash('Please select the Veyra staff position you are applying for.','error')
            return render_template(
                'staff_apply.html',
                user=u,
                application=dict(latest) if latest else None,
                form_data=request.form
            ),400
'''
if "allowed_positions={" not in app:
    app = app.replace(timezone_line, timezone_line + position_code, 1)

# 3) Save selected role with application.
old_insert = '''                    """INSERT INTO staff_applications(
                        user_id,discord_name,age,timezone,availability,about,experience,
                        why_veyra,support_judgment,extra,status,created_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        u['id'],discord_name,age,timezone,availability[:500],
                        about[:2500],experience[:2500],why_veyra[:2500],
                        support_judgment[:2500],extra[:2500],'pending',now()
                    )
'''
new_insert = '''                    """INSERT INTO staff_applications(
                        user_id,discord_name,position,age,timezone,availability,about,experience,
                        why_veyra,support_judgment,extra,status,created_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        u['id'],discord_name,position,age,timezone,availability[:500],
                        about[:2500],experience[:2500],why_veyra[:2500],
                        support_judgment[:2500],extra[:2500],'pending',now()
                    )
'''
if old_insert in app:
    app = app.replace(old_insert, new_insert, 1)
elif "user_id,discord_name,position,age,timezone" not in app:
    fail("Could not safely patch the staff application INSERT statement.")

# 4) Add requested position names to the existing form.
role_field = '''\n      <label class="wide"><span>What position are you applying for? *</span>
        <select name="position" required>
          <option value="" disabled {% if not f.get('position') %}selected{% endif %}>Select a position</option>
          <option value="Outreach & Partnerships" {% if f.get('position')=='Outreach & Partnerships' %}selected{% endif %}>🤝 Outreach & Partnerships</option>
          <option value="Content & Marketing" {% if f.get('position')=='Content & Marketing' %}selected{% endif %}>📱 Content & Marketing</option>
          <option value="Customer Support" {% if f.get('position')=='Customer Support' %}selected{% endif %}>🎫 Customer Support</option>
          <option value="Community Manager" {% if f.get('position')=='Community Manager' %}selected{% endif %}>🌐 Community Manager</option>
          <option value="QA & Beta Tester" {% if f.get('position')=='QA & Beta Tester' %}selected{% endif %}>🧪 QA & Beta Tester</option>
        </select>
      </label>'''
timezone_html = '''      <label><span>Timezone</span><input name="timezone" placeholder="Example: CST / UTC-5" value="{{f.get('timezone','')}}"></label>'''
if 'name="position"' not in html:
    if timezone_html not in html:
        fail("Could not find the Timezone field in templates/staff_apply.html.")
    html = html.replace(timezone_html, timezone_html + role_field, 1)

# Style select exactly like current inputs/textareas.
html = html.replace(
    ".sa-form input,.sa-form textarea{",
    ".sa-form input,.sa-form textarea,.sa-form select{",
)
html = html.replace(
    ".sa-form input:focus,.sa-form textarea:focus{",
    ".sa-form input:focus,.sa-form textarea:focus,.sa-form select:focus{",
)
if ".sa-form select{appearance:auto}" not in html:
    html = html.replace(
        ".sa-form textarea{min-height:120px;resize:vertical}",
        ".sa-form textarea{min-height:120px;resize:vertical}.sa-form select{appearance:auto}",
    )

# 5) Fix the existing live word counter placement if the script is trapped in title block.
broken = "{% block title %}Staff Application — Veyra\n<script>"
if broken in html:
    script_start = html.index("<script>", html.index(broken))
    script_end = html.index("</script>", script_start) + len("</script>")
    js = html[script_start:script_end]
    before_title = html[:html.index("{% block title %}")]
    after_script = html[script_end:]
    after_script = after_script.replace("{% endblock %}\n{% block top_title %}", "{% block top_title %}", 1)
    html = before_title + "{% block title %}Staff Application — Veyra{% endblock %}\n" + after_script
    last_end = html.rfind("{% endblock %}")
    html = html[:last_end] + "\n" + js + "\n" + html[last_end:]

if "countWords" not in html or "data-min-words" not in html:
    fail("The existing word-count code was not found. Patch stopped to avoid changing your form incorrectly.")

APP.write_text(app, encoding="utf-8")
HTML.write_text(html, encoding="utf-8")

print("[OK] Added staff position dropdown.")
print("[OK] Position is saved with the application.")
print("[OK] Existing questions were not removed.")
print("[OK] 5-word counters remain live: red under 5, green at 5+.")
print()
print("Now run:")
print("git add app.py templates/staff_apply.html")
print('git commit -m "Add Veyra staff positions"')
print("git push origin main")
