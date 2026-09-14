VEYRA SOCIAL PREVIEW GIF PATCH

WHAT IT ADDS
- static/veyra-social-card.gif  -> animated Discord/Open Graph preview
- static/veyra-social-card.png  -> static fallback for X/Twitter and platforms that do not animate OG GIFs
- templates/social_meta_snippet.html -> exact meta tags to put in your base <head>

HOW TO APPLY
1. Copy the static files into your real Veyra repo's static folder.
2. Open templates/base.html.
3. Inside the <head> section, add:
   {% include 'social_meta_snippet.html' %}
4. Copy templates/social_meta_snippet.html into your real repo's templates folder.

GIT
git add .
git commit -m "Add animated Veyra social preview"
git pull --rebase origin main
git push origin main

IMPORTANT
Discord caches link previews. After deployment, if the old preview still appears, try sharing:
https://buildveyra.xyz/?v=2
Then later normal links should refresh as Discord recrawls the page.

The GIF loops through Veyra build / preview / QA states to make the embed feel alive like the Figma-style preview you showed.
