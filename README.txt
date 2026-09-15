VEYRA ADMIN V2 UI PATCH

WHAT IS INCLUDED
- templates/admin_dashboard_v2.html
- static/admin-v2.css
- static/admin-v2.js
- templates/login_social_buttons_v2.html
- discord_oauth_app_patch.py

IMPORTANT
This package is a UI/integration patch. It intentionally does NOT invent or overwrite your current
database mutation routes. The dashboard expects real data from your existing Flask admin backend.
User row form actions default to "#" unless you pass the existing route URLs into each user object.

RECOMMENDED INSTALL
1. Copy templates/admin_dashboard_v2.html into your templates folder.
2. Copy static/admin-v2.css and static/admin-v2.js into your static folder.
3. Change the existing admin route to render:
      return render_template("admin_dashboard_v2.html", ...)
4. Pass these variables:
      user
      users
      stats
      pending_vouches
      support_threads
      audit_rows
      live_activity (optional)
5. For each user dict, optionally attach:
      plan_action
      credit_action
      add100_action
      add1000_action
      restrict_action
      unrestrict_action
   This lets the new UI call your current secure POST routes without changing backend behavior.

NO NATIVE PLAN DROPDOWN
The ugly browser select UI is gone. Plans use a custom menu with Free / Pro / Max cards and a hidden
input named "plan", so normal form submission still works.

DISCORD LOGIN
Open discord_oauth_app_patch.py and copy the registration/routes into app.py.
Then replace the Google/GitHub button section in login.html (and signup.html if used) with the contents
of templates/login_social_buttons_v2.html.

DO NOT PASTE SECRETS INTO CODE.
Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET only in Vercel environment variables.
