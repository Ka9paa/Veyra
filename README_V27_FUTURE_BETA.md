# VEYRA STUDIO V27 — FUTURE BETA

Major additions:
- Futuristic public-site redesign
- Public vouch archive with approved historical vouches
- Signed-in vouch submission + admin approval
- FAQ, Docs, Roadmap, Changelog, Security, Status, About, Contact, Privacy, Terms
- Floating Veyra Support bot across the site
- AI-powered support when OpenAI is configured, deterministic FAQ fallback otherwise
- Stripe Payment Link ready Pro/Max purchasing flow
- Checkout explainer page that refuses to pretend payments are configured when they are not
- Expanded navigation/footer and stronger responsive public UI

Before accepting real paid customers:
1. Configure Stripe Payment Links in .env
2. Implement and test Stripe subscription webhooks
3. Update user plan/credits from verified webhook events
4. Replace beta legal placeholders with attorney-reviewed Terms and Privacy policies
