VEYRA ADMIN V3 PREMIUM

Files:
- templates/admin_dashboard_v3.html
- static/admin-v3.css
- static/admin-v3.js

This is a full visual rebuild of the admin dashboard. It adds a premium command-center layout, KPI cards, inline charts, command palette, system health, user management, custom Free/Pro/Max plan menus, search/filtering, credit editing UI, row action menus, credit economy, support feed, integrations, audit log, moderation center, feature flags, and responsive layouts.

Use it by making your Flask /admin route render admin_dashboard_v3.html and passing user, users, stats, support_threads, and audit_rows. Each user can also provide plan_action, credit_action, add100_action, add1000_action, restrict_action, and unrestrict_action URLs to connect to your existing POST routes.
