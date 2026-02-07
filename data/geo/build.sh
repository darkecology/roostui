#!/usr/bin/env bash
#
# Reproducible geo data pipeline for Roost UI map overlay.
#
# Downloads source data from npm packages and Natural Earth, then extracts
# the subsets needed by the app. All output goes to the current directory
# (data/geo/).
#
# Sources:
#   - us-atlas@3   (npm)   — US states/counties/nation boundaries, 10m resolution
#                             https://github.com/topojson/us-atlas
#   - world-atlas@2 (npm)  — World country boundaries, 10m resolution
#                             https://github.com/topojson/world-atlas
#   - Natural Earth         — Lakes (ne_10m_lakes), GeoJSON via GitHub
#                             https://www.naturalearthdata.com/
#
# Dependencies: node, npx (for mapshaper), curl
#
# Usage:
#   cd data/geo
#   bash build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Working in $WORK_DIR"

# ---------- us-atlas (states, counties, nation) ----------

echo "Downloading us-atlas@3..."
(cd "$WORK_DIR" && npm pack us-atlas@3 --quiet 2>/dev/null)
tar xzf "$WORK_DIR"/us-atlas-*.tgz -C "$WORK_DIR"

cp "$WORK_DIR/package/states-10m.json"   "$SCRIPT_DIR/states-10m.json"
cp "$WORK_DIR/package/counties-10m.json" "$SCRIPT_DIR/counties-10m.json"
echo "  states-10m.json   $(wc -c < "$SCRIPT_DIR/states-10m.json" | tr -d ' ') bytes"
echo "  counties-10m.json $(wc -c < "$SCRIPT_DIR/counties-10m.json" | tr -d ' ') bytes"

# ---------- world-atlas (neighbor countries) ----------

echo "Downloading world-atlas@2..."
(cd "$WORK_DIR" && npm pack world-atlas@2 --quiet 2>/dev/null)
tar xzf "$WORK_DIR"/world-atlas-*.tgz -C "$WORK_DIR"

# Extract Mexico (484), Canada (124), Cuba (192), Bahamas (044) as a
# minimal TopoJSON subset with only referenced arcs.
echo "Extracting neighbor countries..."
node -e '
var fs = require("fs");
var src = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
var neighborIds = new Set(["124", "484", "192", "044"]);

var geoms = src.objects.countries.geometries.filter(function(g) {
    return neighborIds.has(g.id);
});

var referencedArcs = new Set();
function collectArcs(a) {
    if (!Array.isArray(a)) return;
    a.forEach(function(item) {
        if (Array.isArray(item)) collectArcs(item);
        else referencedArcs.add(item < 0 ? ~item : item);
    });
}
geoms.forEach(function(g) { collectArcs(g.arcs); });

var oldToNew = {};
var newArcs = [];
Array.from(referencedArcs).sort(function(a, b) { return a - b; }).forEach(function(oldIdx, newIdx) {
    oldToNew[oldIdx] = newIdx;
    newArcs.push(src.arcs[oldIdx]);
});

function remapArcs(a) {
    if (!Array.isArray(a)) return a;
    return a.map(function(item) {
        if (Array.isArray(item)) return remapArcs(item);
        return item < 0 ? ~oldToNew[~item] : oldToNew[item];
    });
}

var output = {
    type: "Topology",
    arcs: newArcs,
    transform: src.transform,
    objects: {
        countries: {
            type: "GeometryCollection",
            geometries: geoms.map(function(g) {
                return { type: g.type, id: g.id, properties: g.properties, arcs: remapArcs(g.arcs) };
            })
        }
    }
};
process.stdout.write(JSON.stringify(output));
' "$WORK_DIR/package/countries-10m.json" > "$WORK_DIR/neighbors-unclipped.json"

# Clip to a generous bounding box around CONUS + southern Canada/northern Mexico.
# Removes Arctic Canada, southern Mexico, and distant islands that are never
# visible from any US radar station (150km range).
echo "Clipping to CONUS bounding box..."
npx mapshaper "$WORK_DIR/neighbors-unclipped.json" \
    -clip bbox=-180,15,-50,55 \
    -o format=topojson "$SCRIPT_DIR/neighbors-10m.json" 2>&1
echo "  neighbors-10m.json $(wc -c < "$SCRIPT_DIR/neighbors-10m.json" | tr -d ' ') bytes"

# ---------- Natural Earth lakes ----------

echo "Downloading Natural Earth lakes (10m)..."
LAKES_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson"
curl -sL "$LAKES_URL" -o "$WORK_DIR/ne_10m_lakes.geojson"

# Filter to North American Great Lakes + major lakes visible at radar scale.
# Keep lakes with scalerank <= 1 in the bounding box covering CONUS + southern Canada.
echo "Filtering lakes..."
node -e '
var fs = require("fs");
var src = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
var features = src.features.filter(function(f) {
    var p = f.properties;
    return p.scalerank <= 1;
});
var out = { type: "FeatureCollection", features: features };
process.stdout.write(JSON.stringify(out));
' "$WORK_DIR/ne_10m_lakes.geojson" > "$SCRIPT_DIR/lakes.json"
echo "  lakes.json $(wc -c < "$SCRIPT_DIR/lakes.json" | tr -d ' ') bytes"

echo ""
echo "Done. Output files in $SCRIPT_DIR:"
ls -lh "$SCRIPT_DIR"/*.json
