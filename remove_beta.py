from pathlib import Path

def replace_many(path, replacements):
    p = Path(path)
    if not p.exists():
        print(f"SKIP: {path} not found")
        return
    s = p.read_text(encoding="utf-8")
    changed = False
    for old, new in replacements:
        if old in s:
            s = s.replace(old, new)
            changed = True
    if changed:
        p.write_text(s, encoding="utf-8")
        print(f"UPDATED: {path}")
    else:
        print(f"NO CHANGES: {path}")

replace_many("templates/app_base.html", [
    ('<span class="beta">BETA</span>', ''),
    ('.brand strong{font-size:17px;letter-spacing:.08em}.beta{font-size:9px;color:#bca9ff;border:1px solid #5c438f;border-radius:999px;padding:2px 6px}', '.brand strong{font-size:17px;letter-spacing:.08em}'),
    ('.brand strong,.brand .beta,.nav span', '.brand strong,.nav span'),
])

replace_many("templates/base.html", [
    ("Beta assistant", "Veyra assistant"),
    ("Veyra Public Beta", "Veyra"),
])

replace_many("app.py", [
    ("Straight answers about Veyra beta, credits, building, exports, support, and account access.", "Straight answers about Veyra, credits, building, exports, support, and account access."),
    ("Is Veyra still in beta?", "Is Veyra publicly available?"),
    ("Yes. The public beta is where we are testing the product with real builders before the full Veyra 1.0 release.", "Yes. Veyra is publicly available and continues to improve as new features, integrations, and reliability updates are released."),
    ("Direct hosting integrations are still beta.", "Direct hosting integrations are still limited."),
    ("Signed-in beta users can submit a vouch.", "Signed-in users can submit a vouch."),
    ("6. Report beta issues", "6. Report issues"),
    ("The beta roadmap focuses on making the builder more reliable before adding unnecessary noise.", "The product roadmap focuses on making the builder more reliable before adding unnecessary noise."),
    ("Major beta improvements without hiding the rough edges.", "Major Veyra improvements without hiding the rough edges."),
    ("Veyra is still in beta, so security claims stay specific instead of exaggerated.", "Veyra keeps security claims specific instead of exaggerated."),
    ("Current beta systems and what each one actually means.", "Current Veyra systems and what each one actually means."),
    ("Limited beta — use project export until deployment integrations are connected.", "Limited — use project export until deployment integrations are connected."),
    ("Veyra is in public beta. Never claim an unfinished feature works. ", "Never claim an unfinished feature works. "),
    ("Exported from Veyra Beta — buildveyra.xyz", "Exported from Veyra — buildveyra.xyz"),
])

print("Done.")
