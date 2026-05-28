#!/usr/bin/env python3
"""Phase 6 Slice 2 patch: replace MapViewPage with geocoding + coord quality UI."""

import sys

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# ── 1. Replace the MapViewPage component ──────────────────────────────────────

OLD_MVP_START = """  /* ═══════════════════════════════════════════════════════
     PHASE 6 — SLICE 1: MapViewPage (HQ-only, read-only)
     No Mapbox token detected → styled SVG grid placeholder
     with active-order list and lat/lon ready for wiring.
  ═══════════════════════════════════════════════════════ */"""

OLD_MVP_END = """  var renderPage = function renderPage() {"""

# Find positions
start_pos = content.find(OLD_MVP_START)
end_pos   = content.find(OLD_MVP_END)
if start_pos == -1 or end_pos == -1:
    print("ERROR: Could not find MapViewPage markers")
    sys.exit(1)

# Extract the block to replace (from start_pos to end_pos, exclusive)
old_block = content[start_pos:end_pos]

NEW_MVP = r"""  /* ═══════════════════════════════════════════════════════
     PHASE 6 — SLICE 2: MapViewPage — Geocoding + Coord Quality
     Nominatim geocoding pipeline, coordinate status tracking,
     "needs coordinates" filter, colored pins, manual override form.
  ═══════════════════════════════════════════════════════ */

  /* ── Geocoding helpers (Nominatim / OpenStreetMap — no API key) ── */
  var GEO_CACHE_KEY = "casabe_geocache_v2";
  var COORD_STATUSES = { missing: "missing", geocoded: "geocoded", low_confidence: "low_confidence", manual_override: "manual_override" };

  function loadGeoCache() {
    try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); } catch(e) { return {}; }
  }
  function saveGeoCache(cache) {
    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch(e) {}
  }
  function hasUsableCoords(entry) {
    if (!entry) return false;
    return entry.status === COORD_STATUSES.geocoded || entry.status === COORD_STATUSES.manual_override;
  }
  function coordStatusLabel(s) {
    if (s === COORD_STATUSES.geocoded)        return "Geocoded";
    if (s === COORD_STATUSES.low_confidence)  return "Low Confidence";
    if (s === COORD_STATUSES.manual_override) return "Manual Override";
    return "Missing";
  }
  function coordStatusColor(s) {
    if (s === COORD_STATUSES.geocoded)        return "var(--green)";
    if (s === COORD_STATUSES.low_confidence)  return "var(--amber)";
    if (s === COORD_STATUSES.manual_override) return "var(--blue)";
    return "var(--red)";
  }
  function coordStatusIcon(s) {
    if (s === COORD_STATUSES.geocoded)        return "📍";
    if (s === COORD_STATUSES.low_confidence)  return "⚠️";
    if (s === COORD_STATUSES.manual_override) return "✏️";
    return "❓";
  }
  /* Throttled Nominatim geocoding — respects 1 req/sec usage policy */
  var _geoQueue = [];
  var _geoRunning = false;
  function enqueueGeocode(address, callback) {
    _geoQueue.push({ address: address, callback: callback });
    if (!_geoRunning) drainGeoQueue();
  }
  function drainGeoQueue() {
    if (_geoQueue.length === 0) { _geoRunning = false; return; }
    _geoRunning = true;
    var item = _geoQueue.shift();
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(item.address);
    fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "CasabeKonnectR4/dev" } })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.length > 0) {
          var result = data[0];
          var importance = parseFloat(result.importance || "0");
          var status = importance >= 0.4 ? COORD_STATUSES.geocoded : COORD_STATUSES.low_confidence;
          item.callback(null, { lat: parseFloat(result.lat), lon: parseFloat(result.lon), status: status, importance: importance });
        } else {
          item.callback(null, { lat: null, lon: null, status: COORD_STATUSES.missing });
        }
      })
      .catch(function(err) {
        item.callback(err, { lat: null, lon: null, status: COORD_STATUSES.missing });
      })
      .finally(function() {
        setTimeout(drainGeoQueue, 1100); // 1.1s throttle per Nominatim ToS
      });
  }

  var MapViewPage = function MapViewPage(_ref_mvp) {
    var _orders  = _ref_mvp.orders;
    var _session = _ref_mvp.session || {};
    var _notify  = _ref_mvp.notify || function() {};
    var _onCoordOverride = _ref_mvp.onCoordOverride || function() {};

    var ACTIVE_STATUSES = ["received","in_warehouse","ready_pickup","in_transit","out_for_delivery","loaded_container","processing"];
    var activeOrders = (_orders || []).filter(function(o) { return ACTIVE_STATUSES.includes(o.status); });

    /* ── Local state ── */
    var _useState_gc = useState(function() { return loadGeoCache(); });
    var geoCache = _useState_gc[0], setGeoCache = _useState_gc[1];

    var _useState_cf = useState("all");
    var coordFilter = _useState_cf[0], setCoordFilter = _useState_cf[1];

    var _useState_pin = useState(null);
    var selectedPin = _useState_pin[0], setSelectedPin = _useState_pin[1];

    var _useState_ov = useState(false);
    var showOverride = _useState_ov[0], setShowOverride = _useState_ov[1];

    var _useState_of = useState({ orderId: "", lat: "", lon: "", note: "" });
    var overrideForm = _useState_of[0], setOverrideForm = _useState_of[1];

    var _useState_al = useState([]);
    var activityLog = _useState_al[0], setActivityLog = _useState_al[1];

    var _useState_gc2 = useState(false);
    var geocoding = _useState_gc2[0], setGeocoding = _useState_gc2[1];

    /* ── Auto-geocode orders without coords on mount + when orders change ── */
    useEffect(function() {
      var cache = loadGeoCache();
      var toGeocode = activeOrders.filter(function(o) {
        var entry = cache[o.id];
        // Skip if already geocoded (non-missing), don't overwrite manual_override
        if (entry && (entry.status === COORD_STATUSES.geocoded || entry.status === COORD_STATUSES.manual_override)) return false;
        // Skip if address is empty
        var addr = [o.address, o.city, o.state].filter(Boolean).join(", ");
        return addr.length > 3;
      });
      if (toGeocode.length === 0) return;
      setGeocoding(true);
      var completed = 0;
      toGeocode.forEach(function(o) {
        var addr = [o.address, o.city, o.state].filter(Boolean).join(", ");
        enqueueGeocode(addr, function(err, result) {
          setGeoCache(function(prev) {
            var updated = Object.assign({}, prev);
            updated[o.id] = Object.assign({}, result, { cachedAt: Date.now(), address: addr });
            saveGeoCache(updated);
            return updated;
          });
          completed++;
          if (completed >= toGeocode.length) setGeocoding(false);
        });
      });
    }, [activeOrders.length]);

    /* ── Coordinate stats ── */
    var coordStats = activeOrders.reduce(function(acc, o) {
      var entry = geoCache[o.id];
      var st = entry ? entry.status : COORD_STATUSES.missing;
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    }, {});
    var usableCount  = (coordStats.geocoded || 0) + (coordStats.manual_override || 0);
    var missingCount = (coordStats.missing || 0) + (coordStats.low_confidence || 0);

    /* ── Filtered orders ── */
    var filteredOrders = coordFilter === "needs_coordinates"
      ? activeOrders.filter(function(o) { var e = geoCache[o.id]; return !e || e.status === COORD_STATUSES.missing || e.status === COORD_STATUSES.low_confidence; })
      : activeOrders;

    /* ── Status color for order delivery status ── */
    var statusColor = function(s) {
      if (s === "ready_pickup" || s === "in_transit" || s === "out_for_delivery") return "var(--amber)";
      if (s === "in_warehouse" || s === "loaded_container") return "var(--blue)";
      if (s === "received" || s === "processing") return "var(--teal)";
      return "var(--text3)";
    };

    /* ── Pin layout (max 10 pins across map canvas) ── */
    var PIN_OFFSETS = [
      { dx: 12, dy: 30 }, { dx: 24, dy: 62 }, { dx: 38, dy: 20 },
      { dx: 52, dy: 55 }, { dx: 65, dy: 35 }, { dx: 22, dy: 80 },
      { dx: 48, dy: 75 }, { dx: 72, dy: 20 }, { dx: 60, dy: 68 },
      { dx: 82, dy: 48 }
    ];

    /* ── Manual coordinate override handler ── */
    var handleOverrideSave = function() {
      var oid = overrideForm.orderId.trim();
      var lat = parseFloat(overrideForm.lat);
      var lon = parseFloat(overrideForm.lon);
      if (!oid) { _notify("⚠ Please select an order."); return; }
      if (isNaN(lat) || lat < -90 || lat > 90) { _notify("⚠ Invalid latitude (must be -90 to 90)."); return; }
      if (isNaN(lon) || lon < -180 || lon > 180) { _notify("⚠ Invalid longitude (must be -180 to 180)."); return; }

      var prevEntry = geoCache[oid] || { lat: null, lon: null, status: COORD_STATUSES.missing };
      var newEntry  = { lat: lat, lon: lon, status: COORD_STATUSES.manual_override, cachedAt: Date.now(), overriddenBy: _session.email || "hq", overrideNote: overrideForm.note || "" };

      /* Write to activity_log (in-memory + would persist to Supabase activity_log via onCoordOverride) */
      var logEntry = {
        id: "coord_" + Date.now(),
        activity_type: "coordinate_override",
        order_id: oid,
        old_data: { lat: prevEntry.lat, lon: prevEntry.lon, coordinate_status: prevEntry.status },
        new_data: { lat: lat, lon: lon, coordinate_status: COORD_STATUSES.manual_override, note: overrideForm.note || "" },
        user_email: _session.email || "hq",
        created_at: new Date().toISOString()
      };
      setActivityLog(function(prev) { return [logEntry].concat(prev).slice(0, 50); });

      setGeoCache(function(prev) {
        var updated = Object.assign({}, prev);
        updated[oid] = newEntry;
        saveGeoCache(updated);
        return updated;
      });
      _onCoordOverride(oid, { lat: lat, lon: lon, coordinate_status: COORD_STATUSES.manual_override });
      setOverrideForm({ orderId: "", lat: "", lon: "", note: "" });
      setShowOverride(false);
      _notify("✅ Coordinates saved for " + oid);
    };

    /* ── Render ── */
    return /*#__PURE__*/React.createElement("div", { className: "fu" },

      /* ── Header row ── */
      /*#__PURE__*/React.createElement("div", { className: "row g10 mb18", style: { flexWrap: "wrap" } },
        /*#__PURE__*/React.createElement("h2", { style: { fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, flex: 1 } }, "\uD83D\uDDFA\uFE0F Active Order Map"),
        /*#__PURE__*/React.createElement("span", { className: "badge ba" }, activeOrders.length + " active"),
        geocoding && /*#__PURE__*/React.createElement("span", { className: "badge bb" }, "\u29D7 Geocoding..."),
        /*#__PURE__*/React.createElement("span", { className: "tag tag-b", style: { fontSize: 10, padding: "3px 9px", borderRadius: 6 } }, "\uD83D\uDD12 Read-Only \u2014 Phase 6 Slice 2")
      ),

      /* ── Coordinate quality stats ── */
      /*#__PURE__*/React.createElement("div", { className: "sg4 mb18" },
        /*#__PURE__*/React.createElement("div", { className: "sc sc-g" },
          /*#__PURE__*/React.createElement("div", { className: "sc-ico" }, "\uD83D\uDCCD"),
          /*#__PURE__*/React.createElement("div", { className: "sc-lbl" }, "Geocoded"),
          /*#__PURE__*/React.createElement("div", { className: "sc-val", style: { color: "var(--green)" } }, coordStats.geocoded || 0)
        ),
        /*#__PURE__*/React.createElement("div", { className: "sc sc-b" },
          /*#__PURE__*/React.createElement("div", { className: "sc-ico" }, "\u270F\uFE0F"),
          /*#__PURE__*/React.createElement("div", { className: "sc-lbl" }, "Manual Override"),
          /*#__PURE__*/React.createElement("div", { className: "sc-val", style: { color: "var(--blue)" } }, coordStats.manual_override || 0)
        ),
        /*#__PURE__*/React.createElement("div", { className: "sc sc-a" },
          /*#__PURE__*/React.createElement("div", { className: "sc-ico" }, "\u26A0\uFE0F"),
          /*#__PURE__*/React.createElement("div", { className: "sc-lbl" }, "Low Confidence"),
          /*#__PURE__*/React.createElement("div", { className: "sc-val", style: { color: "var(--amber)" } }, coordStats.low_confidence || 0)
        ),
        /*#__PURE__*/React.createElement("div", { className: "sc sc-r" },
          /*#__PURE__*/React.createElement("div", { className: "sc-ico" }, "\u2753"),
          /*#__PURE__*/React.createElement("div", { className: "sc-lbl" }, "Missing"),
          /*#__PURE__*/React.createElement("div", { className: "sc-val", style: { color: "var(--red)" } }, coordStats.missing || 0)
        )
      ),

      /* ── Filter chips + Override button ── */
      /*#__PURE__*/React.createElement("div", { className: "row g10 mb18", style: { flexWrap: "wrap" } },
        /*#__PURE__*/React.createElement("div", { className: "chips" },
          /*#__PURE__*/React.createElement("button", { className: "chip" + (coordFilter === "all" ? " on" : ""), onClick: function() { setCoordFilter("all"); } }, "All Orders"),
          /*#__PURE__*/React.createElement("button", {
            id: "needs-coords-filter",
            className: "chip" + (coordFilter === "needs_coordinates" ? " on" : ""),
            onClick: function() { setCoordFilter("needs_coordinates"); }
          }, "\u26A0 Needs Coordinates (" + missingCount + ")")
        ),
        /*#__PURE__*/React.createElement("button", {
          id: "manual-coord-override-btn",
          className: "btn btn-blue btn-sm mla",
          onClick: function() { setShowOverride(function(v) { return !v; }); }
        }, "\u270F\uFE0F Fix Coordinates")
      ),

      /* ── Manual override form (collapsible) ── */
      showOverride && /*#__PURE__*/React.createElement("div", { id: "coord-override-form", className: "card mb18" },
        /*#__PURE__*/React.createElement("div", { className: "card-hd" },
          /*#__PURE__*/React.createElement("span", { className: "card-title" }, "\u270F\uFE0F Manual Coordinate Override"),
          /*#__PURE__*/React.createElement("span", { className: "xs mut" }, "HQ only \u2014 writes to activity_log")
        ),
        /*#__PURE__*/React.createElement("div", { className: "card-bd" },
          /*#__PURE__*/React.createElement("div", { className: "alert alert-a mb12" },
            "\uD83D\uDEC1 Overriding coordinates preserves history in activity_log. Old lat/lon is logged before the update."
          ),
          /*#__PURE__*/React.createElement("div", { className: "fr3" },
            /*#__PURE__*/React.createElement("div", { className: "fg" },
              /*#__PURE__*/React.createElement("label", { className: "fl" }, "Order ID"),
              /*#__PURE__*/React.createElement("select", {
                className: "fi",
                value: overrideForm.orderId,
                onChange: function(e) { setOverrideForm(function(f) { return Object.assign({}, f, { orderId: e.target.value }); }); }
              },
                /*#__PURE__*/React.createElement("option", { value: "" }, "Select order..."),
                activeOrders.map(function(o) {
                  return /*#__PURE__*/React.createElement("option", { key: o.id, value: o.id }, o.id + " — " + (o.name || ""));
                })
              )
            ),
            /*#__PURE__*/React.createElement("div", { className: "fg" },
              /*#__PURE__*/React.createElement("label", { className: "fl" }, "Latitude"),
              /*#__PURE__*/React.createElement("input", {
                id: "override-lat",
                className: "fi", type: "number", step: "0.0001",
                placeholder: "e.g. 25.7617",
                value: overrideForm.lat,
                onChange: function(e) { setOverrideForm(function(f) { return Object.assign({}, f, { lat: e.target.value }); }); }
              })
            ),
            /*#__PURE__*/React.createElement("div", { className: "fg" },
              /*#__PURE__*/React.createElement("label", { className: "fl" }, "Longitude"),
              /*#__PURE__*/React.createElement("input", {
                id: "override-lon",
                className: "fi", type: "number", step: "0.0001",
                placeholder: "e.g. -80.1918",
                value: overrideForm.lon,
                onChange: function(e) { setOverrideForm(function(f) { return Object.assign({}, f, { lon: e.target.value }); }); }
              })
            )
          ),
          /*#__PURE__*/React.createElement("div", { className: "fg" },
            /*#__PURE__*/React.createElement("label", { className: "fl" }, "Note (optional)"),
            /*#__PURE__*/React.createElement("input", {
              className: "fi", type: "text",
              placeholder: "e.g. Customer confirmed address via phone",
              value: overrideForm.note,
              onChange: function(e) { setOverrideForm(function(f) { return Object.assign({}, f, { note: e.target.value }); }); }
            })
          ),
          /*#__PURE__*/React.createElement("div", { className: "row g10" },
            /*#__PURE__*/React.createElement("button", {
              id: "override-save-btn",
              className: "btn btn-primary",
              onClick: handleOverrideSave
            }, "\uD83D\uDCBE Save Override"),
            /*#__PURE__*/React.createElement("button", {
              className: "btn btn-ghost",
              onClick: function() { setShowOverride(false); setOverrideForm({ orderId: "", lat: "", lon: "", note: "" }); }
            }, "Cancel")
          )
        )
      ),

      /* ── Map canvas ── */
      /*#__PURE__*/React.createElement("div", { className: "card mb18" },
        /*#__PURE__*/React.createElement("div", { className: "card-hd" },
          /*#__PURE__*/React.createElement("span", { className: "card-title" }, "Order Pins \u2014 Coordinate Quality View"),
          /*#__PURE__*/React.createElement("div", { className: "row g6 xs" },
            /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCCD Geocoded"),
            /*#__PURE__*/React.createElement("span", null, "\u270F\uFE0F Manual"),
            /*#__PURE__*/React.createElement("span", { style: { color: "var(--amber)" } }, "\u26A0\uFE0F Low Conf."),
            /*#__PURE__*/React.createElement("span", { style: { color: "var(--red)" } }, "\u2753 Missing")
          )
        ),
        /*#__PURE__*/React.createElement("div", {
          style: { position: "relative", height: 360, background: "var(--bg)", borderRadius: "0 0 11px 11px", overflow: "hidden" }
        },
          /*#__PURE__*/React.createElement("div", { className: "map-grid", style: { position: "absolute", inset: 0 } }),
          /*#__PURE__*/React.createElement("div", { style: {
            position: "absolute", inset: 0,
            background: "linear-gradient(160deg, rgba(14,28,60,0.55) 0%, rgba(7,9,15,0.9) 100%)"
          } }),
          /*#__PURE__*/React.createElement("svg", {
            style: { position: "absolute", inset: 0, width: "100%", height: "100%" },
            viewBox: "0 0 100 100", preserveAspectRatio: "none"
          },
            /*#__PURE__*/React.createElement("defs", null,
              /*#__PURE__*/React.createElement("radialGradient", { id: "bay-grd2", cx: "70%", cy: "50%", r: "40%" },
                /*#__PURE__*/React.createElement("stop", { offset: "0%", stopColor: "#1e3a5f", stopOpacity: "0.45" }),
                /*#__PURE__*/React.createElement("stop", { offset: "100%", stopColor: "transparent", stopOpacity: "0" })
              )
            ),
            /*#__PURE__*/React.createElement("ellipse", { cx: "78", cy: "50", rx: "22", ry: "38", fill: "url(#bay-grd2)" }),
            /*#__PURE__*/React.createElement("line", { x1: "0", y1: "40", x2: "70", y2: "40", stroke: "rgba(59,130,246,0.12)", strokeWidth: "0.5" }),
            /*#__PURE__*/React.createElement("line", { x1: "0", y1: "60", x2: "70", y2: "60", stroke: "rgba(59,130,246,0.12)", strokeWidth: "0.5" }),
            /*#__PURE__*/React.createElement("line", { x1: "30", y1: "0", x2: "30", y2: "100", stroke: "rgba(59,130,246,0.12)", strokeWidth: "0.5" }),
            /*#__PURE__*/React.createElement("line", { x1: "55", y1: "0", x2: "55", y2: "100", stroke: "rgba(59,130,246,0.12)", strokeWidth: "0.5" }),
            /*#__PURE__*/React.createElement("line", { x1: "20", y1: "0", x2: "22", y2: "100", stroke: "rgba(245,158,11,0.18)", strokeWidth: "1" })
          ),

          /* Order pins — color/icon by coordinate_status */
          filteredOrders.slice(0, PIN_OFFSETS.length).map(function(o, i) {
            var pos      = PIN_OFFSETS[i];
            var entry    = geoCache[o.id];
            var cStatus  = entry ? entry.status : COORD_STATUSES.missing;
            var icon     = coordStatusIcon(cStatus);
            var isSelected = selectedPin && selectedPin.id === o.id;
            return /*#__PURE__*/React.createElement("div", {
              key: o.id,
              className: "map-pin",
              title: o.id + " \u2014 " + coordStatusLabel(cStatus),
              "data-coord-status": cStatus,
              onClick: function() { setSelectedPin(isSelected ? null : o); },
              style: {
                left: pos.dx + "%", top: pos.dy + "%",
                animationDelay: (i * 0.15) + "s",
                cursor: "pointer", zIndex: 10,
                fontSize: 20,
                filter: isSelected
                  ? "drop-shadow(0 0 8px " + coordStatusColor(cStatus) + ")"
                  : "drop-shadow(0 0 3px " + coordStatusColor(cStatus) + "88)"
              }
            }, icon);
          }),

          /* Popup */
          selectedPin && (function() {
            var entry   = geoCache[selectedPin.id];
            var cStatus = entry ? entry.status : COORD_STATUSES.missing;
            var latStr  = entry && entry.lat != null ? entry.lat.toFixed(5) + "\xB0N" : "—";
            var lonStr  = entry && entry.lon != null ? Math.abs(entry.lon).toFixed(5) + "\xB0W" : "—";
            return /*#__PURE__*/React.createElement("div", {
              style: {
                position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
                background: "var(--bg2)", border: "1px solid " + coordStatusColor(cStatus),
                borderRadius: 10, padding: "10px 14px", minWidth: 220, zIndex: 20,
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)"
              }
            },
              /*#__PURE__*/React.createElement("div", { className: "row g6", style: { marginBottom: 5 } },
                /*#__PURE__*/React.createElement("span", { className: "tamb" }, selectedPin.id),
                /*#__PURE__*/React.createElement("span", {
                  className: "badge xs",
                  style: { background: coordStatusColor(cStatus) + "22", color: coordStatusColor(cStatus), fontSize: 9 }
                }, coordStatusLabel(cStatus)),
                /*#__PURE__*/React.createElement("span", { className: "mla xs", style: { cursor: "pointer", color: "var(--text3)" }, onClick: function() { setSelectedPin(null); } }, "\xD7")
              ),
              /*#__PURE__*/React.createElement("div", { className: "tb xs" }, selectedPin.name),
              /*#__PURE__*/React.createElement("div", { className: "mut xs", style: { marginTop: 3 } }, (selectedPin.address || "") + (selectedPin.city ? ", " + selectedPin.city : "")),
              /*#__PURE__*/React.createElement("div", { className: "mono xs", style: { marginTop: 5, opacity: 0.8 } }, latStr + ", " + lonStr),
              entry && entry.importance != null && /*#__PURE__*/React.createElement("div", { className: "xs mut", style: { marginTop: 2 } }, "Importance: " + (entry.importance * 100).toFixed(0) + "%")
            );
          })(),

          /* Legend */
          /*#__PURE__*/React.createElement("div", {
            style: { position: "absolute", bottom: 10, right: 12, fontSize: 10, color: "rgba(100,116,139,0.6)", fontFamily: "'IBM Plex Mono',monospace" }
          }, "Miami Metro \u2022 Nominatim/OSM")
        )
      ),

      /* ── Activity log (manual overrides) ── */
      activityLog.length > 0 && /*#__PURE__*/React.createElement("div", { className: "card mb18" },
        /*#__PURE__*/React.createElement("div", { className: "card-hd" },
          /*#__PURE__*/React.createElement("span", { className: "card-title" }, "\uD83D\uDCCB Coordinate Override Log"),
          /*#__PURE__*/React.createElement("span", { className: "xs mut" }, activityLog.length + " entries this session")
        ),
        /*#__PURE__*/React.createElement("div", { className: "card-bd" },
          activityLog.map(function(log) {
            return /*#__PURE__*/React.createElement("div", { key: log.id, className: "act" },
              /*#__PURE__*/React.createElement("div", { className: "act-dot", style: { background: "var(--blue)" } }),
              /*#__PURE__*/React.createElement("div", null,
                /*#__PURE__*/React.createElement("div", { className: "act-txt" },
                  /*#__PURE__*/React.createElement("strong", null, log.user_email),
                  " set coordinates for ",
                  /*#__PURE__*/React.createElement("strong", null, log.order_id),
                  " \u2192 " + log.new_data.lat + ", " + log.new_data.lon,
                  log.new_data.note ? " (" + log.new_data.note + ")" : ""
                ),
                /*#__PURE__*/React.createElement("div", { className: "act-time" }, log.created_at + " \u2022 old: " + (log.old_data.lat != null ? log.old_data.lat + ", " + log.old_data.lon : "none"))
              )
            );
          })
        )
      ),

      /* ── Active orders table with coordinate status ── */
      /*#__PURE__*/React.createElement("div", { className: "card" },
        /*#__PURE__*/React.createElement("div", { className: "card-hd" },
          /*#__PURE__*/React.createElement("span", { className: "card-title" }, "Active Orders \u2014 Coordinate Status"),
          /*#__PURE__*/React.createElement("span", { className: "xs mut" }, filteredOrders.length + " orders \u2022 read-only")
        ),
        /*#__PURE__*/React.createElement("div", { className: "tbl" },
          /*#__PURE__*/React.createElement("table", null,
            /*#__PURE__*/React.createElement("thead", null,
              /*#__PURE__*/React.createElement("tr", null,
                /*#__PURE__*/React.createElement("th", null, "Order"),
                /*#__PURE__*/React.createElement("th", null, "Customer"),
                /*#__PURE__*/React.createElement("th", null, "Status"),
                /*#__PURE__*/React.createElement("th", null, "Address"),
                /*#__PURE__*/React.createElement("th", null, "Coord Status"),
                /*#__PURE__*/React.createElement("th", null, "Coordinates")
              )
            ),
            /*#__PURE__*/React.createElement("tbody", null,
              filteredOrders.length === 0
                ? /*#__PURE__*/React.createElement("tr", null,
                    /*#__PURE__*/React.createElement("td", { colSpan: 6, style: { textAlign: "center", padding: 24, color: "var(--text4)" } },
                      coordFilter === "needs_coordinates" ? "\u2713 All active orders have usable coordinates!" : "No active orders"
                    )
                  )
                : filteredOrders.map(function(o) {
                    var entry   = geoCache[o.id];
                    var cStatus = entry ? entry.status : COORD_STATUSES.missing;
                    var latStr  = entry && entry.lat  != null ? entry.lat.toFixed(4)  : "—";
                    var lonStr  = entry && entry.lon  != null ? entry.lon.toFixed(4)  : "—";
                    return /*#__PURE__*/React.createElement("tr", { key: o.id, onClick: function() { setSelectedPin(o); } },
                      /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", { className: "tamb" }, o.id)),
                      /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", { className: "tb" }, o.name)),
                      /*#__PURE__*/React.createElement("td", null,
                        /*#__PURE__*/React.createElement("span", {
                          className: "badge",
                          style: { background: statusColor(o.status) + "22", color: statusColor(o.status) }
                        }, o.status.replace(/_/g, " "))
                      ),
                      /*#__PURE__*/React.createElement("td", { className: "mut" }, (o.address || "") + (o.city ? ", " + o.city : "")),
                      /*#__PURE__*/React.createElement("td", null,
                        /*#__PURE__*/React.createElement("span", {
                          className: "badge",
                          "data-coord-status": cStatus,
                          style: { background: coordStatusColor(cStatus) + "22", color: coordStatusColor(cStatus) }
                        }, coordStatusIcon(cStatus) + " " + coordStatusLabel(cStatus))
                      ),
                      /*#__PURE__*/React.createElement("td", { className: "mono xs mut" },
                        latStr !== "—" ? latStr + "\xB0, " + lonStr + "\xB0" : "—"
                      )
                    );
                  })
            )
          )
        )
      )
    );
  };

"""

# ── 2. Replace old renderPage map_view render call ──────────────────────────

OLD_MAPVIEW_RENDER = 'if (page === "map_view") return /*#__PURE__*/React.createElement(MapViewPage, { orders: orders });'
NEW_MAPVIEW_RENDER = 'if (page === "map_view") return /*#__PURE__*/React.createElement(MapViewPage, { orders: orders, session: session, notify: notify, onCoordOverride: function(oid, patch) { setOrders(function(prev) { return prev.map(function(o) { return o.id === oid ? Object.assign({}, o, patch) : o; }); }); } });'

# ── Apply replacements ─────────────────────────────────────────────────────

# 1. Replace the MapViewPage block
old_block = content[start_pos:end_pos]
new_content = content[:start_pos] + NEW_MVP + content[end_pos:]

# 2. Replace the renderPage call
old_mapview_render = 'if (page === "map_view") return /*#__PURE__*/React.createElement(MapViewPage, { orders: orders });'
new_mapview_render = 'if (page === "map_view") return /*#__PURE__*/React.createElement(MapViewPage, { orders: orders, session: session, notify: notify, onCoordOverride: function(oid, patch) { setOrders(function(prev) { return prev.map(function(o) { return o.id === oid ? Object.assign({}, o, patch) : o; }); }); } });'

if old_mapview_render not in new_content:
    print("ERROR: Could not find old renderPage call for map_view")
    sys.exit(1)
new_content = new_content.replace(old_mapview_render, new_mapview_render, 1)

# ── Write output ─────────────────────────────────────────────────────────────
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"OK: replaced MapViewPage ({len(old_block)} chars → {len(NEW_MVP)} chars)")
print(f"OK: updated renderPage map_view call")
print(f"Final file size: {len(new_content)} chars")
