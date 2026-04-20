#!/bin/bash
# Generates PNG icons from an inline SVG using rsvg-convert or Inkscape.
# Run from the icons/ directory.
# Requires: rsvg-convert (brew install librsvg) OR inkscape

SVG=$(cat <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#1a2e1f"/>
  <text x="64" y="92" font-size="80" text-anchor="middle" font-family="serif" fill="#4a7c59">D</text>
  <text x="64" y="92" font-size="80" text-anchor="middle" font-family="serif" fill="#6db88a" opacity="0.35">D</text>
</svg>
EOF
)

echo "$SVG" > icon.svg

for SIZE in 16 32 48 128; do
  if command -v rsvg-convert &> /dev/null; then
    rsvg-convert -w $SIZE -h $SIZE icon.svg -o ${SIZE}.png
  elif command -v inkscape &> /dev/null; then
    inkscape --export-width=$SIZE --export-height=$SIZE --export-filename=${SIZE}.png icon.svg
  else
    echo "Install librsvg (brew install librsvg) or Inkscape to generate PNGs."
    exit 1
  fi
  echo "Generated ${SIZE}.png"
done

rm icon.svg
echo "Done."
EOF
