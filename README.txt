VEYRA CLEAN SOCIAL PREVIEW PATCH

This replaces the old social preview image that accidentally included a Discord screenshot.

Replace these two files in your real repo:
static/veyra-social-card.gif
static/veyra-social-card.png

Your existing social_meta_snippet.html can stay exactly the same.

After copying:
git add static/veyra-social-card.gif static/veyra-social-card.png
git commit -m "Fix Veyra social preview artwork"
git push origin main

Then test Discord with:
https://buildveyra.xyz/?v=5
