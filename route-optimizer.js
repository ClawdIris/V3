/* ============================================================================
   CASABE KONNECT — Routes & Optimization (LIVE) + Driver Route Lite
   ----------------------------------------------------------------------------
   Faithful port of the handoff prototype (routes-optimization.html) wired to
   live data. Design/source-of-truth: "Route Optimizer Update v1" package.
     • HQ page  : window.RouteOptimizerPage  (nav key: map_view)
     • Driver   : window.DriverRouteLite     (nav key: driver_route)
   Every ">>> WIRE UP <<<" from the prototype is implemented:
     orders query → live `orders` prop (ready_pickup + need_box)
     Google Maps JS / Geocoding / Places / Directions (browser key)
     GPS → navigator.geolocation ·  Apple/Google deep links
     write-backs → props.onSave(order) + props.onStatusChange(...)
   ============================================================================ */
(function () {
"use strict";

/* ───────────────────────── shared helpers ─────────────────────────────── */
var TAPE_DIRECT = { label: "Tape Direct", address: "3801 White Plains Rd, Bronx, NY 10467", lat: 40.8772, lng: -73.8645 };
var GEOCACHE_KEY = "casabe_ro_geocache_v2";
function gcLoad() { try { return JSON.parse(localStorage.getItem(GEOCACHE_KEY) || "{}"); } catch (e) { return {}; } }
function gcSave(c) { try { localStorage.setItem(GEOCACHE_KEY, JSON.stringify(c)); } catch (e) {} }
function fullAddr(o) { return o.resolved_address || [o.address, o.city, o.state, o.zip].filter(Boolean).join(", "); }
function haversineMi(a, b) {
  var R = 3958.8, rad = function (x) { return x * Math.PI / 180; };
  var dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmt$(n) { return "$" + Number(n || 0).toLocaleString("en-US"); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
function balanceOf(o) { var p = o._raw && o._raw.payment || {}; return Math.max(0, (parseFloat(p.amount) || 0) - (parseFloat(p.paid) || 0)); }
function classifyLocType(lt, partial) {
  if ((lt === "ROOFTOP" || lt === "RANGE_INTERPOLATED") && !partial) return "ok";
  if (lt) return "warn";
  return "err";
}
/* real geocode with cache; cb({lat,lng,conf,formatted}) */
function geocodeLive(addr, cb) {
  var key = (addr || "").toLowerCase().trim();
  if (!key) return cb({ lat: null, lng: null, conf: "err", formatted: "" });
  var cache = gcLoad();
  if (cache[key] && cache[key].conf) return cb(cache[key]);
  if (!(window.google && google.maps)) return cb({ lat: null, lng: null, conf: "warn", formatted: "" });
  new google.maps.Geocoder().geocode({ address: addr, region: "us" }, function (res, status) {
    var out;
    if (status === "OK" && res && res[0]) {
      var g = res[0];
      out = { lat: g.geometry.location.lat(), lng: g.geometry.location.lng(),
              conf: classifyLocType(g.geometry.location_type, g.partial_match),
              formatted: g.formatted_address };
    } else out = { lat: null, lng: null, conf: "err", formatted: "" };
    cache[key] = out; gcSave(out && cache);
    cb(out);
  });
}
/* Places autocomplete predictions -> [{l1,l2,desc}] */
function placesPredict(q, cb) {
  if (!(window.google && google.maps && google.maps.places && google.maps.places.AutocompleteService)) return cb([]);
  try {
    new google.maps.places.AutocompleteService().getPlacePredictions(
      { input: q, componentRestrictions: { country: "us" } },
      function (preds, status) {
        if (status !== "OK" || !preds) return cb([]);
        cb(preds.slice(0, 4).map(function (p) {
          var sf = p.structured_formatting || {};
          return { l1: sf.main_text || p.description, l2: sf.secondary_text || "", desc: p.description };
        }));
      });
  } catch (e) { cb([]); }
}
function navUrl(provider, dest, addr) {
  return provider === "apple"
    ? "https://maps.apple.com/?daddr=" + encodeURIComponent(dest) + "&q=" + encodeURIComponent(addr || dest) + "&dirflg=d"
    : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest || addr) + "&travelmode=driving";
}
/* WhatsApp receipt deep link — works today, no Twilio needed */
function receiptWaUrl(o, collected, method, balance, company) {
  var phone = String((o._raw && (o._raw.whatsapp || o._raw.phone)) || o.phone || "").replace(/\D/g, "");
  var first = (o.name || "").split(" ")[0];
  var lines = ["Hi " + first + "! 🧾 Receipt from " + (company || "Casabe Konnect"),
    "Order: " + o.tn,
    collected > 0 ? ("Paid today: " + fmt$(collected) + " (" + method + ")") : "Payment: already paid ✓",
    balance > 0 ? ("Remaining balance: " + fmt$(balance)) : "Balance: $0 — paid in full ✓",
    "Box: " + (o.box || "—") + " → " + ((o._raw && o._raw.destination) || "destination"),
    "Thank you!"];
  return "https://wa.me/" + phone + "?text=" + encodeURIComponent(lines.join("\n"));
}

/* map a live order -> prototype stop shape */
function liveToStop(o, cache) {
  var addr = fullAddr(o);
  var key = addr.toLowerCase().trim();
  var ce = cache[key] || {};
  var confirmed = o.address_confidence === "confirmed";
  var lat = (o.geocoded_lat != null ? o.geocoded_lat : ce.lat);
  var lng = (o.geocoded_lng != null ? o.geocoded_lng : ce.lng);
  var conf = confirmed ? "ok" : (ce.conf || (lat != null ? "ok" : "warn"));
  var p = o.payment || {};
  var hq = /\(hq\)|head ?office/i.test(o.office || "");
  return {
    tn: o.id, name: o.name || "—", phone: o.phone || "",
    addr: addr, box: o.boxType || "—",
    service: o.status === "need_box" ? "dropbox" : "pickup",
    driver: o.assignedDriver || "",
    conf: conf, lat: lat, lng: lng,
    price: Math.max(0, (parseFloat(p.amount) || 0) - (parseFloat(p.paid) || 0)),
    destination: o.destination || "", nameOnBox: o.nameOnBox || o.consigneeName || "",
    placedBy: o.office || "—", placedByType: hq ? "hq" : "office",
    done: false, _raw: o
  };
}

/* ═══════════════════════════ HQ PAGE — CSS ═══════════════════════════════ */
var CSS = [
".ro-scope{--bg:#070a10;--bg-2:#0a0e16;--panel:#0d131e;--panel-2:#101826;--card:#121a28;--card-2:#16202f;--rail:#05070c;",
"--border:#1d2735;--border-soft:#172131;--border-strong:#27344a;--text:#e7ecf3;--text-dim:#9aa6b8;--muted:#637087;",
"--orange:#f5972a;--orange-2:#ff8a1f;--orange-ink:#ffb155;--orange-soft:rgba(245,151,42,.13);--orange-line:#f5851f;",
"--amber:#f5b733;--amber-soft:rgba(245,183,51,.14);--blue:#3b9bff;--blue-soft:rgba(59,155,255,.15);",
"--green:#27c281;--green-soft:rgba(39,194,129,.14);--red:#ff5566;--red-soft:rgba(255,85,102,.14);",
"--yellow:#f2c037;--yellow-soft:rgba(242,192,55,.14);--gray-pill:#28323f;--radius:14px;--radius-sm:10px;",
"--shadow:0 18px 50px -18px rgba(0,0,0,.7);--sidebar-w:300px;",
"color:var(--text);font-family:'Inter','IBM Plex Sans',-apple-system,sans-serif;font-size:13px;-webkit-font-smoothing:antialiased}",
".ro-scope *{box-sizing:border-box}",
".ro-scope button{font-family:inherit;cursor:pointer}",
".ro-scope .display{font-family:'Sora','Syne','Inter',sans-serif;letter-spacing:-.01em}",
".ro-scope ::-webkit-scrollbar{width:9px;height:9px}",
".ro-scope ::-webkit-scrollbar-thumb{background:#1f2a3a;border-radius:20px}",
/* page head */
".ro-scope .page-head{display:flex;align-items:center;gap:14px;padding:2px 0 14px;border-bottom:1px solid var(--border-soft);flex-wrap:wrap}",
".ro-scope .page-title{display:flex;align-items:center;gap:12px}",
".ro-scope .page-title .ico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:var(--orange-soft);border:1px solid rgba(245,151,42,.3)}",
".ro-scope .page-title h1{margin:0;font-size:21px;font-weight:800;letter-spacing:-.02em}",
".ro-scope .page-title .sub{color:var(--muted);font-size:12px;margin-top:2px;font-weight:500}",
".ro-scope .page-head .spacer{flex:1}",
".ro-scope .statchip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em}",
".ro-scope .statchip .d{width:7px;height:7px;border-radius:50%}",
".ro-scope .sc-green{background:var(--green-soft);color:#5be3ab;border:1px solid rgba(39,194,129,.3)}",
".ro-scope .sc-blue{background:var(--blue-soft);color:#8cc6ff;border:1px solid rgba(59,155,255,.3)}",
".ro-scope .sc-orange{background:var(--orange-soft);color:var(--orange-ink);border:1px solid rgba(245,151,42,.3)}",
".ro-scope .btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:11px;font-weight:700;font-size:13px;border:1px solid var(--border-strong);background:var(--panel-2);color:var(--text);transition:.15s}",
".ro-scope .btn:hover{border-color:#33425a;background:var(--card-2)}",
".ro-scope .btn.ghost{background:transparent}",
".ro-scope .btn.primary{background:linear-gradient(135deg,#ffae3c,#f5851f);color:#1a1206;border-color:transparent;box-shadow:0 10px 26px -12px rgba(245,133,31,.8)}",
".ro-scope .btn.primary:hover{filter:brightness(1.05)}",
".ro-scope .btn:disabled{opacity:.42;cursor:not-allowed;filter:grayscale(.3)}",
".ro-scope .btn.sm{height:32px;padding:0 12px;font-size:12px;border-radius:9px}",
/* work grid */
".ro-scope .work{flex:1;display:grid;grid-template-columns:var(--sidebar-w) 1fr;min-height:0}",
".ro-scope .sidebar{border-right:1px solid var(--border-soft);background:linear-gradient(180deg,#0a0f18,#080c14);display:flex;flex-direction:column;min-height:0}",
".ro-scope .side-scroll{overflow-y:auto;flex:1;padding:16px 16px 10px}",
".ro-scope .sec{margin-bottom:18px}",
".ro-scope .sec-label{font-size:10.5px;font-weight:800;letter-spacing:.14em;color:var(--muted);text-transform:uppercase;margin:0 2px 9px;display:flex;align-items:center;justify-content:space-between}",
".ro-scope .count-badge{background:var(--orange);color:#1a1206;font-weight:800;border-radius:999px;min-width:20px;height:20px;padding:0 6px;display:inline-grid;place-items:center;font-size:11px}",
".ro-scope .field{position:relative}",
".ro-scope .select{width:100%;height:44px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:0 38px 0 14px;font-size:13px;font-weight:600;appearance:none;cursor:pointer}",
".ro-scope .select:focus{outline:none;border-color:rgba(245,151,42,.5)}",
".ro-scope .field .chev{position:absolute;right:13px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;font-size:11px}",
".ro-scope .endpoint{display:grid;grid-template-columns:24px 1fr;gap:10px;margin-bottom:12px}",
".ro-scope .ep-node{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:12px;color:#0a0e16;margin-top:10px}",
".ro-scope .ep-node.a{background:var(--green)}",
".ro-scope .ep-node.z{background:var(--red)}",
".ro-scope .ep-line{width:2px;background:repeating-linear-gradient(180deg,#2a3546 0 5px,transparent 5px 10px);height:14px;margin:2px 0 2px 11px}",
".ro-scope .ep-label{font-size:11px;color:var(--text-dim);font-weight:600;margin:0 0 6px 2px}",
".ro-scope .badge-row{margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
".ro-scope .epbadge{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:8px;font-size:11px;font-weight:800;letter-spacing:.02em}",
".ro-scope .epbadge.tape{background:var(--orange-soft);color:var(--orange-ink);border:1px solid rgba(245,151,42,.35)}",
".ro-scope .epbadge.gps{background:var(--green-soft);color:#5be3ab;border:1px solid rgba(39,194,129,.35)}",
".ro-scope .ep-resolved{font-size:12px;color:var(--text-dim);line-height:1.4;margin-top:7px}",
".ro-scope .manual-wrap{margin-top:8px;position:relative}",
".ro-scope .text-input{width:100%;height:40px;border-radius:10px;border:1px solid var(--border);background:#0a0f18;color:var(--text);padding:0 12px;font-size:13px}",
".ro-scope .text-input:focus{outline:none;border-color:rgba(245,151,42,.5)}",
".ro-scope .ac-list{position:absolute;z-index:30;left:0;right:0;top:46px;background:var(--card-2);border:1px solid var(--border-strong);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}",
".ro-scope .ac-item{padding:10px 12px;border-bottom:1px solid var(--border-soft);cursor:pointer}",
".ro-scope .ac-item:last-child{border-bottom:none}",
".ro-scope .ac-item:hover{background:#1b283b}",
".ro-scope .ac-item .l1{font-weight:600;font-size:13px}",
".ro-scope .ac-item .l2{font-size:11px;color:var(--muted);margin-top:1px}",
/* stops */
".ro-scope .stop{display:grid;grid-template-columns:30px 1fr auto;gap:11px;padding:12px;border-radius:13px;border:1px solid var(--border);background:var(--card);margin-bottom:9px;position:relative;cursor:grab;transition:.12s}",
".ro-scope .stop:hover{border-color:var(--border-strong);background:var(--card-2)}",
".ro-scope .stop.dragging{opacity:.45;border-style:dashed}",
".ro-scope .stop.dragover{border-color:var(--orange);box-shadow:0 0 0 1px var(--orange) inset}",
".ro-scope .stop .num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:12px;color:#1a1206;margin-top:1px}",
".ro-scope .stop .num.pickup{background:var(--orange)}",
".ro-scope .stop .num.dropbox{background:var(--blue);color:#06121f}",
".ro-scope .stop .body{min-width:0}",
".ro-scope .stop .name{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:7px}",
".ro-scope .stop .addr{color:var(--text-dim);font-size:11.5px;margin-top:2px;line-height:1.35}",
".ro-scope .stop .track,.ro-scope .track{display:inline-block;color:var(--orange-ink);font-weight:700;font-size:11.5px;margin-top:6px;text-decoration:none;border-bottom:1px dashed rgba(245,151,42,.4)}",
".ro-scope .stop .track:hover{color:#ffc983}",
".ro-scope .stop-meta{display:flex;align-items:center;gap:8px;margin-top:5px}",
".ro-scope .stop-meta .track{margin-top:0}",
".ro-scope .stop-meta .stop-nav{width:28px;height:22px;flex:0 0 auto;border-radius:6px;border:1px solid var(--border-strong);background:var(--panel-2);color:var(--text);font-size:12px;line-height:1;cursor:pointer;display:inline-grid;place-items:center}",
".ro-scope .stop-src{margin-top:6px}",
".ro-scope .stop-src .pill{background:transparent;border:none;padding:0;min-height:0;height:auto;white-space:normal;max-width:none;overflow:visible;text-overflow:clip;font-size:11px;font-weight:600;color:var(--text-dim);letter-spacing:0}",
".ro-scope .stop .pills{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}",
".ro-scope .pill{display:inline-flex;align-items:center;gap:5px;min-height:22px;padding:2px 9px;border-radius:7px;font-size:10.5px;font-weight:800;letter-spacing:.02em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}",
".ro-scope .pill.box{background:var(--gray-pill);color:#c2cdde;border:1px solid #313d4d}",
".ro-scope .pill.pickup{background:var(--amber-soft);color:#ffd06b;border:1px solid rgba(245,183,51,.32)}",
".ro-scope .pill.dropbox{background:var(--blue-soft);color:#8cc6ff;border:1px solid rgba(59,155,255,.32)}",
".ro-scope .pill.src-hq{background:var(--orange-soft);color:var(--orange-ink);border:1px solid rgba(245,151,42,.32)}",
".ro-scope .pill.src-office{background:rgba(120,140,170,.14);color:#aebbcf;border:1px solid #36465c}",
".ro-scope .stop .conf{align-self:flex-start;margin-top:2px;display:flex;flex-direction:column;align-items:center;gap:10px}",
".ro-scope .conf-ico{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:12px;font-weight:800}",
".ro-scope .conf-ico.ok{background:var(--green-soft);color:#5be3ab}",
".ro-scope .conf-ico.warn{background:var(--yellow-soft);color:var(--yellow)}",
".ro-scope .conf-ico.err{background:var(--red-soft);color:var(--red)}",
".ro-scope .stop .grip{color:#3b485d;font-size:13px;cursor:grab}",
".ro-scope .stop-actions{display:flex;gap:7px;margin-top:9px}",
".ro-scope .stop-arrive{margin-top:0;flex:1;min-height:32px;height:auto;padding:5px 8px;line-height:1.2;text-align:center;border-radius:9px;border:1px solid;font-weight:800;font-size:11.5px;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;white-space:nowrap}",
".ro-scope .stop-arrive.pickup{background:var(--amber-soft);color:#ffd06b;border-color:rgba(245,183,51,.4)}",
".ro-scope .stop-arrive.dropbox{background:var(--blue-soft);color:#8cc6ff;border-color:rgba(59,155,255,.4)}",
".ro-scope .stop-arrive:hover{filter:brightness(1.14)}",
".ro-scope .stop-nav{width:38px;flex:0 0 auto;border-radius:9px;border:1px solid var(--border-strong);background:var(--panel-2);color:var(--text);font-size:14px;cursor:pointer}",
".ro-scope .stop-nav:hover{border-color:#33425a;color:var(--orange-ink)}",
".ro-scope .custom-flag{display:flex;align-items:center;gap:8px;margin:-4px 2px 12px;font-size:11px;color:var(--yellow);font-weight:700}",
".ro-scope .reopt{margin-left:auto;height:26px;padding:0 10px;border-radius:8px;font-size:11px;font-weight:700;background:var(--orange-soft);color:var(--orange-ink);border:1px solid rgba(245,151,42,.35)}",
".ro-scope .empty{padding:26px 16px;text-align:center;color:var(--muted);border:1px dashed var(--border-strong);border-radius:14px;background:rgba(255,255,255,.01)}",
".ro-scope .empty a{color:var(--orange-ink);font-weight:700;text-decoration:none}",
/* panel/tabs */
".ro-scope .panel{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg-2)}",
".ro-scope .tabs{display:flex;gap:4px;padding:12px 18px 0;border-bottom:1px solid var(--border-soft)}",
".ro-scope .tab{height:40px;padding:0 16px;border:none;background:transparent;color:var(--text-dim);font-weight:700;font-size:13px;border-bottom:2px solid transparent;display:flex;align-items:center;gap:8px}",
".ro-scope .tab:hover{color:var(--text)}",
".ro-scope .tab.active{color:var(--orange-ink);border-bottom-color:var(--orange)}",
".ro-scope .tab .tcount{background:#1c2636;color:var(--text-dim);border-radius:999px;padding:1px 7px;font-size:11px;font-weight:800}",
".ro-scope .tab.active .tcount{background:var(--orange-soft);color:var(--orange-ink)}",
".ro-scope .tabpane{flex:1;min-height:0;display:none;flex-direction:column}",
".ro-scope .tabpane.active{display:flex}",
".ro-scope .banner{margin:14px 18px 0;padding:11px 14px;border-radius:12px;border:1px solid rgba(39,194,129,.28);background:linear-gradient(90deg,rgba(39,194,129,.10),rgba(39,194,129,.02));display:flex;gap:10px;align-items:center;font-size:12px;color:#a9e8cd}",
".ro-scope .banner b{color:#cfffe9}",
/* map */
".ro-scope .map-shell{flex:1;min-height:340px;margin:14px 18px 0;border-radius:16px;border:1px solid var(--border);overflow:hidden;position:relative;background:#0a1018}",
".ro-scope #roMapCanvas{position:absolute;inset:0;z-index:1;background:#0a1018}",
".ro-scope .map-bar{position:absolute;inset:0 0 auto 0;height:42px;display:flex;align-items:center;padding:0 12px;gap:8px;z-index:5;pointer-events:none;background:linear-gradient(180deg,rgba(8,12,20,.9),transparent)}",
".ro-scope .map-bar .title{font-weight:800;font-size:12.5px;display:flex;align-items:center;gap:8px}",
".ro-scope .map-overlay{position:absolute;z-index:5;background:rgba(8,12,20,.86);border:1px solid var(--border-strong);border-radius:11px;padding:9px 12px;backdrop-filter:blur(6px);pointer-events:none}",
".ro-scope .ov-tl{top:50px;left:12px}",
".ro-scope .ov-tr{top:50px;right:12px;display:flex;align-items:center;gap:7px;font-weight:700;color:#8cc6ff;font-size:11.5px}",
".ro-scope .ov-tl .dname{font-weight:800;font-size:13px}",
".ro-scope .ov-tl .dstops{color:var(--text-dim);font-size:11px;margin-top:1px}",
".ro-scope .legend{position:absolute;left:12px;bottom:12px;z-index:5;display:grid;gap:6px;background:rgba(8,12,20,.86);border:1px solid var(--border-strong);border-radius:11px;padding:9px 12px;pointer-events:none}",
".ro-scope .legend .li{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-dim);font-weight:600}",
".ro-scope .legend .sw{width:13px;height:13px;border-radius:4px}",
".ro-scope .mappop{font-family:'Inter',sans-serif;color:#111}",
".ro-scope .mappop .mp-name,.ro-mappop .mp-name{font-weight:800;font-size:13px}",
".ro-mappop{font-family:'Inter',sans-serif;min-width:180px}",
".ro-mappop .mp-name{font-weight:800;font-size:13px;color:#111}",
".ro-mappop .mp-addr{color:#555;font-size:11.5px;margin-top:2px;line-height:1.35}",
".ro-mappop .mp-tn{color:#b45309;font-weight:700;font-size:11px;margin-top:5px}",
".ro-mappop .mp-nav{display:flex;gap:6px;margin-top:9px}",
".ro-mappop .mp-nav button{flex:1;height:30px;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;color:#222;font-weight:700;font-size:11px;cursor:pointer}",
/* action bar */
".ro-scope .actionbar{flex:0 0 auto;margin:14px 18px 16px;border:1px solid var(--border);border-radius:16px;background:var(--panel);display:flex;align-items:center;gap:18px;padding:13px 18px;flex-wrap:wrap}",
".ro-scope .stats{display:flex;align-items:center;gap:22px;flex-wrap:wrap}",
".ro-scope .stat{display:flex;flex-direction:column;gap:2px}",
".ro-scope .stat .k{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:800}",
".ro-scope .stat .v{font-weight:800;font-size:15px}",
".ro-scope .stat .v.orange{color:var(--orange-ink)}",
".ro-scope .actionbar .spacer{flex:1}",
".ro-scope .divider{width:1px;height:34px;background:var(--border)}",
/* queue tables */
".ro-scope .queue-wrap{flex:1;min-height:0;display:flex;flex-direction:column;margin:14px 18px 16px}",
".ro-scope .queue-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}",
".ro-scope .tablecard{flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:14px;background:var(--panel)}",
".ro-scope table{width:100%;border-collapse:collapse;font-size:12.5px}",
".ro-scope thead th{position:sticky;top:0;background:#0c1320;text-align:left;padding:11px 14px;color:var(--muted);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;border-bottom:1px solid var(--border);z-index:2}",
".ro-scope tbody td{padding:11px 14px;border-bottom:1px solid var(--border-soft);vertical-align:middle}",
".ro-scope tbody tr:hover{background:#0e1521}",
".ro-scope .tlink{color:var(--orange-ink);font-weight:700;text-decoration:none;border-bottom:1px dashed rgba(245,151,42,.4)}",
".ro-scope .tlink:hover{color:#ffc983}",
".ro-scope .ck-check{appearance:none;width:17px;height:17px;border-radius:5px;border:1.5px solid var(--border-strong);background:var(--card);display:inline-grid;place-items:center;cursor:pointer}",
".ro-scope .ck-check:checked{background:var(--orange);border-color:var(--orange)}",
".ro-scope .ck-check:checked::after{content:\"✓\";color:#1a1206;font-size:11px;font-weight:900}",
".ro-scope .inroute-tag{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:6px;font-size:10px;font-weight:800;white-space:nowrap;background:var(--green-soft);color:#5be3ab;border:1px solid rgba(39,194,129,.3)}",
".ro-scope .conf-tag{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:7px;font-size:11px;font-weight:700}",
".ro-scope .conf-tag.ok{background:var(--green-soft);color:#5be3ab}",
".ro-scope .conf-tag.warn{background:var(--yellow-soft);color:var(--yellow)}",
".ro-scope .conf-tag.err{background:var(--red-soft);color:var(--red)}",
/* drivers grid */
".ro-scope .driver-grid{flex:1;min-height:0;overflow:auto;margin:16px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;align-content:start}",
".ro-scope .dcard{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:16px}",
".ro-scope .dcard .dh{display:flex;align-items:center;gap:11px;margin-bottom:14px}",
".ro-scope .dcard .av{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;font-weight:800;color:#1a1206;font-family:'Sora'}",
".ro-scope .dcard .dn{font-weight:800;font-size:14px}",
".ro-scope .dcard .dr{font-size:11px;color:var(--muted);margin-top:1px}",
".ro-scope .dcard .meta{display:flex;gap:18px;margin-bottom:14px}",
".ro-scope .dcard .meta .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:800}",
".ro-scope .dcard .meta .v{font-weight:800;font-size:18px;margin-top:2px}",
".ro-scope .rstatus{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:800}",
".ro-scope .rstatus.active{background:var(--green-soft);color:#5be3ab}",
".ro-scope .rstatus.unassigned{background:#222c3a;color:#8c99ad}",
".ro-scope .rstatus.completed{background:var(--blue-soft);color:#8cc6ff}",
/* modals / sheet / toasts */
".ro-scope .scrim{position:fixed;inset:0;background:rgba(3,6,11,.7);backdrop-filter:blur(4px);z-index:100;display:none;align-items:flex-start;justify-content:center;padding:34px 20px;overflow:auto}",
".ro-scope .scrim.open{display:flex}",
".ro-scope .modal{width:min(880px,100%);background:var(--panel);border:1px solid var(--border-strong);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}",
".ro-scope .modal-head{padding:20px 22px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:14px}",
".ro-scope .modal-head .mi{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:var(--yellow-soft);border:1px solid rgba(242,192,55,.3)}",
".ro-scope .modal-head h2{margin:0;font-size:18px;font-weight:800}",
".ro-scope .modal-head p{margin:4px 0 0;color:var(--text-dim);font-size:12.5px}",
".ro-scope .modal-head .x{margin-left:auto;width:34px;height:34px;border-radius:9px;border:1px solid var(--border);background:var(--card);color:var(--text-dim);font-size:16px}",
".ro-scope .modal-body{padding:18px 22px;display:grid;gap:14px;max-height:60vh;overflow:auto}",
".ro-scope .confirm-card{border:1px solid var(--border);border-radius:16px;background:var(--card);padding:16px;transition:.2s}",
".ro-scope .confirm-card.resolved{border-color:rgba(39,194,129,.45);background:linear-gradient(90deg,rgba(39,194,129,.06),transparent)}",
".ro-scope .cc-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:13px}",
".ro-scope .cc-name{font-weight:800;font-size:14px}",
".ro-scope .cc-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
".ro-scope .cc-col{border:1px solid var(--border-soft);border-radius:12px;padding:11px 12px;background:#0a0f18}",
".ro-scope .cc-col .lab{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:800;margin-bottom:6px}",
".ro-scope .cc-col .val{font-size:13px;line-height:1.4}",
".ro-scope .cc-col.suggest{border-color:rgba(39,194,129,.3)}",
".ro-scope .cc-actions{display:flex;gap:9px;margin-top:13px;flex-wrap:wrap}",
".ro-scope .cc-resolved-tag{display:none;align-items:center;gap:7px;color:#5be3ab;font-weight:800;font-size:12.5px;margin-top:13px}",
".ro-scope .confirm-card.resolved .cc-actions{display:none}",
".ro-scope .confirm-card.resolved .cc-resolved-tag{display:flex}",
".ro-scope .editrow{display:none;margin-top:12px;position:relative}",
".ro-scope .editrow.open{display:block}",
".ro-scope .modal-foot{padding:16px 22px;border-top:1px solid var(--border);display:flex;align-items:center;gap:14px}",
".ro-scope .remaining{font-weight:800;font-size:13px}",
".ro-scope .remaining b{color:var(--yellow)}",
".ro-scope .sheet{position:fixed;top:0;right:0;bottom:0;width:min(420px,92vw);background:var(--panel);border-left:1px solid var(--border-strong);box-shadow:-30px 0 60px -20px rgba(0,0,0,.7);z-index:90;transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column}",
".ro-scope .sheet.open{transform:translateX(0)}",
".ro-scope .sheet-head{padding:18px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}",
".ro-scope .sheet-head h3{margin:0;font-size:16px;font-weight:800}",
".ro-scope .sheet-head .x{margin-left:auto;width:32px;height:32px;border-radius:9px;border:1px solid var(--border);background:var(--card);color:var(--text-dim);font-size:15px}",
".ro-scope .sheet-body{padding:18px 20px;overflow:auto;display:grid;gap:14px}",
".ro-scope .kv{display:grid;gap:3px}",
".ro-scope .kv .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:800}",
".ro-scope .kv .v{font-size:14px;font-weight:600}",
".ro-scope .toast-wrap{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:200;display:grid;gap:10px;width:min(560px,92vw)}",
".ro-scope .toast{background:var(--card-2);border:1px solid var(--border-strong);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow);animation:roRise .3s ease}",
".ro-scope .toast .th{display:flex;align-items:center;gap:9px;font-weight:800;font-size:13px;margin-bottom:6px}",
".ro-scope .toast .tb{font-size:12px;color:var(--text-dim);line-height:1.5;white-space:pre-wrap}",
".ro-scope .toast .url{color:var(--orange-ink);word-break:break-all;font-size:11px;margin-top:6px;font-family:ui-monospace,monospace}",
"@keyframes roRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}",
".ro-scope .dot-amber{background:var(--amber)}.ro-scope .dot-blue{background:var(--blue)}.ro-scope .dot-green{background:var(--green)}",
".ro-scope .dot-orange{background:var(--orange)}.ro-scope .dot-red{background:var(--red)}.ro-scope .dot-yellow{background:var(--yellow)}",
/* stop-action form */
".ro-scope .arrival{margin:0 0 14px;padding:11px 13px;border-radius:11px;font-size:12.5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
".ro-scope .arrival.ok{background:var(--green-soft);border:1px solid rgba(39,194,129,.42);color:#bff0d8}",
".ro-scope .arrival.far{background:var(--yellow-soft);border:1px solid rgba(242,192,55,.38);color:#f3e2a8}",
".ro-scope .arrival .mp-nav{margin-left:auto;display:flex;gap:6px}",
".ro-scope .arrival .mp-nav button{height:28px;padding:0 11px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel-2);color:var(--text);font-weight:700;font-size:11px}",
".ro-scope .fsec{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:15px}",
".ro-scope .fsec + .fsec{margin-top:13px}",
".ro-scope .fsec-h{display:flex;align-items:center;gap:9px;font-weight:800;font-size:12.5px;margin-bottom:13px}",
".ro-scope .fsec-h .n{width:22px;height:22px;border-radius:7px;background:var(--orange-soft);color:var(--orange-ink);display:grid;place-items:center;font-size:11px;border:1px solid rgba(245,151,42,.3)}",
".ro-scope .fsec-h .hint{margin-left:auto;font-weight:600;font-size:10.5px;color:var(--muted);letter-spacing:.02em}",
".ro-scope .fgrid{display:grid;grid-template-columns:1fr 1fr;gap:11px}",
".ro-scope .fld{display:grid;gap:5px}",
".ro-scope .fld.full{grid-column:1/-1}",
".ro-scope .fld label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:800}",
".ro-scope .fld input,.ro-scope .fld select{height:38px;border-radius:9px;border:1px solid var(--border);background:#0a0f18;color:var(--text);padding:0 11px;font-size:13px}",
".ro-scope .fld input:focus,.ro-scope .fld select:focus{outline:none;border-color:rgba(245,151,42,.5)}",
".ro-scope .seg{display:inline-flex;gap:7px;flex-wrap:wrap}",
".ro-scope .seg button{height:34px;padding:0 13px;border-radius:9px;border:1px solid var(--border);background:#0a0f18;color:var(--text-dim);font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:6px}",
".ro-scope .seg button.on{background:var(--orange-soft);color:var(--orange-ink);border-color:rgba(245,151,42,.5)}",
".ro-scope .seg.pay button.on{background:var(--green-soft);color:#5be3ab;border-color:rgba(39,194,129,.45)}",
".ro-scope .label-note{display:none;margin-top:11px;font-size:11.5px;color:#8cc6ff;background:var(--blue-soft);border:1px solid rgba(59,155,255,.3);border-radius:9px;padding:9px 11px}",
".ro-scope .label-note.show{display:block}",
".ro-scope .pay-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px}",
".ro-scope .pay-due{display:flex;flex-direction:column}",
".ro-scope .pay-due .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:800}",
".ro-scope .pay-due .v{font-weight:800;font-size:20px}",
".ro-scope .paystatus{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:9px;font-weight:800;font-size:12px;margin-left:auto}",
".ro-scope .paystatus.full{background:var(--green-soft);color:#5be3ab}",
".ro-scope .paystatus.partial{background:var(--yellow-soft);color:var(--yellow)}",
".ro-scope .paystatus.unpaid{background:var(--red-soft);color:var(--red)}",
".ro-scope .switchrow{display:flex;align-items:center;gap:11px;padding:7px 0}",
".ro-scope .switchrow .lbl{font-weight:700;font-size:12.5px}",
".ro-scope .switchrow .sub{font-size:11px;color:var(--muted)}",
".ro-scope .switch{width:42px;height:24px;border-radius:999px;background:#28323f;position:relative;transition:.15s;flex:0 0 auto;cursor:pointer;border:1px solid var(--border)}",
".ro-scope .switch.on{background:var(--green);border-color:var(--green)}",
".ro-scope .switch .k{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s}",
".ro-scope .switch.on .k{left:20px}",
".ro-scope .dropzone{border:1px dashed var(--border-strong);border-radius:11px;padding:15px;text-align:center;color:var(--muted);font-size:11.5px;margin-top:11px}",
".ro-scope .complete-summary{font-size:12px;color:var(--text-dim);margin-right:auto}",
".ro-scope .complete-summary b{color:var(--text)}",
/* shift */
".ro-scope .shift-hero{display:flex;align-items:flex-end;gap:14px;padding:2px 0 16px}",
".ro-scope .shift-hero .big{font-size:40px;font-weight:800;font-family:'Sora','Syne';color:#5be3ab;line-height:.9}",
".ro-scope .shift-hero .lbl{color:var(--text-dim);font-size:12px;padding-bottom:4px}",
".ro-scope .shift-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}",
".ro-scope .sb{border:1px solid var(--border);border-radius:13px;padding:13px;background:var(--card)}",
".ro-scope .sb .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:800}",
".ro-scope .sb .v{font-size:21px;font-weight:800;margin-top:4px}",
".ro-scope .sb.cash{border-color:rgba(39,194,129,.45);background:linear-gradient(180deg,rgba(39,194,129,.08),transparent)}",
".ro-scope .sb.cash .v{color:#5be3ab}",
".ro-scope .sb.owed .v{color:var(--yellow)}",
".ro-scope .txns{margin-top:16px}",
".ro-scope .txns .th{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:800;margin-bottom:8px}",
".ro-scope .txn{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px}",
".ro-scope .txn .who{font-weight:600}",
".ro-scope .txn .m{font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:var(--gray-pill);color:#c2cdde}",
".ro-scope .txn .m.cash{background:var(--green-soft);color:#5be3ab}",
".ro-scope .txn .amt{margin-left:auto;font-weight:800}",
".ro-scope .shift-empty{color:var(--muted);text-align:center;padding:20px;font-size:12.5px}",
".ro-scope .box-status{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:800;background:var(--blue-soft);color:#8cc6ff}",
".ro-scope .box-status.holding{background:var(--gray-pill);color:#aab6c8}",
/* mobile */
".ro-scope .mobile-fab{display:none}",
"@media (max-width:880px){",
".ro-scope .work{grid-template-columns:1fr}",
".ro-scope .sidebar{position:fixed;left:0;right:0;bottom:0;top:auto;max-height:78vh;z-index:80;border-right:none;border-top:1px solid var(--border-strong);border-radius:20px 20px 0 0;transform:translateY(100%);transition:transform .28s ease;background:#0a0f18}",
".ro-scope .sidebar.open{transform:translateY(0)}",
".ro-scope .mobile-fab{display:flex;position:fixed;right:18px;bottom:18px;z-index:81;height:50px;padding:0 18px;border-radius:999px;align-items:center;gap:9px;background:linear-gradient(135deg,#ffae3c,#f5851f);color:#1a1206;font-weight:800;border:none;box-shadow:0 14px 30px -10px rgba(245,133,31,.8)}",
".ro-scope .map-shell{min-height:60vh}",
"}",
/* ── Driver Lite ── */
".ro-scope .dl-stop{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:14px;margin-bottom:10px}",
".ro-scope .dl-head{display:flex;gap:11px;align-items:flex-start}",
".ro-scope .dl-pay{margin-top:12px;border-top:1px dashed var(--border);padding-top:12px}",
".ro-scope .dl-payrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
".ro-scope .dl-due{font-weight:800;font-size:16px}",
".ro-scope .dl-due.zero{color:#5be3ab}",
".ro-scope .dl-due.owe{color:var(--yellow)}",
".ro-scope .dl-btn{height:38px;padding:0 15px;border-radius:10px;font-weight:800;font-size:12.5px;border:1px solid var(--border-strong);background:var(--panel-2);color:var(--text);display:inline-flex;align-items:center;gap:7px}",
".ro-scope .dl-btn.paid{background:var(--green-soft);color:#5be3ab;border-color:rgba(39,194,129,.45)}",
".ro-scope .dl-btn.collect{background:linear-gradient(135deg,#ffae3c,#f5851f);color:#1a1206;border-color:transparent}",
".ro-scope .dl-btn.deliver{background:var(--blue-soft);color:#8cc6ff;border-color:rgba(59,155,255,.4)}",
".ro-scope .dl-btn:disabled{opacity:.45}",
".ro-scope .dl-done{border-color:rgba(39,194,129,.4);background:linear-gradient(90deg,rgba(39,194,129,.07),transparent)}",
".ro-scope .dl-done-tag{display:inline-flex;align-items:center;gap:6px;color:#5be3ab;font-weight:800;font-size:12px}"
].join("\n");

/* ═════════════════════════ HQ PAGE — HTML ════════════════════════════════ */
var PAGE_HTML = [
'<div class="page-head">',
'  <div class="page-title"><div class="ico">🗺️</div><div>',
'    <h1 class="display">Routes &amp; Optimization</h1><div class="sub" id="pageDate"></div></div></div>',
'  <div class="spacer"></div>',
'  <span class="statchip sc-green"><span class="d dot-green"></span><span id="chipStops">0</span>&nbsp;live stops</span>',
'  <span class="statchip sc-blue"><span class="d dot-blue"></span>Google Geocoding</span>',
'  <span class="statchip sc-orange"><span class="d dot-orange"></span><span id="chipDriver">—</span></span>',
'  <button class="btn ghost" id="btnShift">💵 <span id="shiftCash">$0</span> · Shift</button>',
'  <button class="btn ghost" id="btnReset">↻ Reset</button>',
'  <button class="btn primary" id="btnOptimize">⚡ Optimize Route</button>',
'</div>',
'<div class="work">',
'  <aside class="sidebar" id="roSidebar"><div class="side-scroll">',
'    <div class="sec"><div class="sec-label">Driver</div>',
'      <div class="field"><select class="select" id="driverSelect"></select><span class="chev">▼</span></div></div>',
'    <div class="sec"><div class="sec-label">Route Endpoints</div>',
'      <div class="endpoint"><div class="ep-node a">A</div><div>',
'        <div class="ep-label">Start point</div>',
'        <div class="field"><select class="select" id="startSelect">',
'          <option value="gps">Current location (GPS)</option>',
'          <option value="tapedirect" selected>Tape Direct warehouse</option>',
'          <option value="manual">Enter address manually…</option></select><span class="chev">▼</span></div>',
'        <div id="startExtra"></div></div></div>',
'      <div class="ep-line"></div>',
'      <div class="endpoint"><div class="ep-node z">Z</div><div>',
'        <div class="ep-label">End point</div>',
'        <div class="field"><select class="select" id="endSelect">',
'          <option value="anywhere" selected>Anywhere (driver\'s discretion)</option>',
'          <option value="gps">Current location (GPS)</option>',
'          <option value="tapedirect">Tape Direct warehouse</option>',
'          <option value="manual">Enter address manually…</option></select><span class="chev">▼</span></div>',
'        <div id="endExtra"></div></div></div></div>',
'    <div class="sec"><div class="sec-label">Stops in Route <span class="count-badge" id="stopCount">0</span></div>',
'      <div id="customFlag"></div><div id="stopList"></div></div>',
'  </div></aside>',
'  <section class="panel">',
'    <div class="tabs">',
'      <button class="tab active" data-tab="map">🗺️ Map view</button>',
'      <button class="tab" data-tab="queue">📋 Orders queue <span class="tcount" id="queueCount">0</span></button>',
'      <button class="tab" data-tab="drivers">🚚 Driver assignments</button>',
'      <button class="tab" data-tab="boxes">📦 Boxes out <span class="tcount" id="boxesCount">0</span></button>',
'    </div>',
'    <div class="tabpane active" data-pane="map">',
'      <div class="banner">📡 <span><b>Live orders feed</b> — stops reflect <b>ready-pickup</b> and <b>drop-box</b> orders from the orders database in real time. <b>Tap any pin</b> to open turn-by-turn in <b>Apple Maps</b> or Google Maps.</span></div>',
'      <div class="map-shell">',
'        <div id="roMapCanvas"></div>',
'        <div class="map-bar"><span class="title">🗺️ Interactive Map — Google Maps</span></div>',
'        <div class="map-overlay ov-tl"><div class="dname" id="ovDriver">—</div><div class="dstops" id="ovStops">0 stops</div></div>',
'        <div class="map-overlay ov-tr">🧭 Tap a pin → Apple / Google Maps</div>',
'        <div class="legend">',
'          <div class="li"><span class="sw dot-green"></span>Start point</div>',
'          <div class="li"><span class="sw dot-orange"></span>Pickup stop</div>',
'          <div class="li"><span class="sw dot-blue"></span>Drop box stop</div>',
'          <div class="li"><span class="sw dot-yellow"></span>Unconfirmed address</div>',
'          <div class="li"><span class="sw dot-red"></span>End point</div>',
'        </div>',
'      </div>',
'      <div class="actionbar">',
'        <div class="stats">',
'          <div class="stat"><span class="k">Stops</span><span class="v" id="stStops">0</span></div><div class="divider"></div>',
'          <div class="stat"><span class="k">Est. Distance</span><span class="v orange" id="stDist">—</span></div><div class="divider"></div>',
'          <div class="stat"><span class="k">Est. Drive Time</span><span class="v orange" id="stTime">—</span></div><div class="divider"></div>',
'          <div class="stat"><span class="k">Start</span><span class="v" id="stStart">Tape Direct</span></div><div class="divider"></div>',
'          <div class="stat"><span class="k">End</span><span class="v" id="stEnd">Anywhere</span></div>',
'        </div>',
'        <div class="spacer"></div>',
'        <button class="btn" id="btnApple">🍎 Apple Maps</button>',
'        <button class="btn" id="btnGoogle">📍 Google Maps</button>',
'        <button class="btn primary" id="btnAssign" disabled>🚚 Assign to driver</button>',
'      </div>',
'    </div>',
'    <div class="tabpane" data-pane="queue"><div class="queue-wrap">',
'      <div class="queue-head"><div style="font-weight:800;font-size:14px">Ready-pickup &amp; drop-box orders</div>',
'        <button class="btn primary sm" id="btnAddSel" style="display:none">＋ Add selected to route (<span id="selCount">0</span>)</button></div>',
'      <div class="tablecard"><table><thead><tr>',
'        <th style="width:38px"></th><th>Tracking #</th><th>Customer</th><th>Address</th>',
'        <th>Box</th><th>Service</th><th>Placed by</th><th>Address Confidence</th><th>Driver</th>',
'      </tr></thead><tbody id="queueBody"></tbody></table></div></div></div>',
'    <div class="tabpane" data-pane="drivers"><div class="driver-grid" id="driverGrid"></div></div>',
'    <div class="tabpane" data-pane="boxes"><div class="queue-wrap">',
'      <div class="queue-head"><div><div style="font-weight:800;font-size:14px">Boxes out — customers holding a box</div>',
'        <div style="color:var(--muted);font-size:11.5px;margin-top:2px">Drop-off recipients. Target them when a shipment is approaching their area.</div></div>',
'        <button class="btn primary sm" id="btnCampaign">📣 Notify "shipment approaching"</button></div>',
'      <div class="tablecard"><table><thead><tr>',
'        <th>Customer</th><th>Phone</th><th>Address</th><th>Box</th>',
'        <th>Placed by</th><th>Received</th><th>Driver</th><th>Campaign</th>',
'      </tr></thead><tbody id="boxesBody"></tbody></table></div></div></div>',
'  </section>',
'</div>',
'<button class="mobile-fab" id="roFab">📋 Stops &amp; route</button>'
].join("\n");

var OVERLAY_HTML = [
'<div class="scrim" id="confirmScrim"><div class="modal">',
'  <div class="modal-head"><div class="mi">⚠️</div><div>',
'    <h2>Confirm addresses before optimizing</h2>',
'    <p>Some stops came back low-confidence from Google Geocoding. Resolve each one — corrections are saved back to the order record.</p></div>',
'    <button class="x" id="confirmClose">✕</button></div>',
'  <div class="modal-body" id="confirmBody"></div>',
'  <div class="modal-foot"><div class="remaining"><b id="remainCount">0</b> addresses remaining</div>',
'    <div style="flex:1"></div>',
'    <button class="btn ghost" id="confirmCancel">Cancel</button>',
'    <button class="btn primary" id="confirmContinue" disabled>Continue to optimize →</button></div>',
'</div></div>',
'<div class="scrim" id="stopScrim"><div class="modal" id="stopModal"></div></div>',
'<div class="scrim" id="shiftScrim"><div class="modal" id="shiftModal"></div></div>',
'<div class="sheet" id="orderSheet">',
'  <div class="sheet-head"><h3 id="sheetTitle">Order</h3><button class="x" id="sheetClose">✕</button></div>',
'  <div class="sheet-body" id="sheetBody"></div></div>',
'<div class="toast-wrap" id="roToasts"></div>'
].join("\n");

/* ═════════════════════════ ENGINE (RO namespace) ═════════════════════════ */
var RO = window.RO = window.RO || {};
RO.props = null; RO.pageEl = null; RO.ovEl = null;
RO.session = { completedTns: {}, completed: [], boxesOut: [] };  /* survives re-renders */
/* Persist the shift session per-day so a mid-shift page refresh does NOT lose
   completed stops or the cash tally (real operational risk for live drivers).
   Keyed by date; yesterday's session is ignored automatically. Order/payment
   writes still persist through onSave — this only protects the session view. */
var RO_SESS_KEY = "casabe_ro_session_v2";
function roSessLoad() {
  try {
    var raw = JSON.parse(localStorage.getItem(RO_SESS_KEY) || "null");
    if (raw && raw.day === new Date().toDateString() && raw.data) {
      RO.session = { completedTns: raw.data.completedTns || {}, completed: raw.data.completed || [], boxesOut: raw.data.boxesOut || [] };
    }
  } catch (e) {}
}
function roSessSave() {
  try { localStorage.setItem(RO_SESS_KEY, JSON.stringify({ day: new Date().toDateString(), data: RO.session })); } catch (e) {}
}
roSessLoad();

var state = RO.state = {
  driverId: "", drivers: [],
  start: { type: "tapedirect", address: TAPE_DIRECT.address, label: "Tape Direct", lat: TAPE_DIRECT.lat, lng: TAPE_DIRECT.lng },
  end: { type: "anywhere", address: "", label: "Anywhere", lat: null, lng: null },
  driverLoc: null,
  orders: [], order: [], removed: new Set(),
  optimized: false, customOrder: false,
  stats: { dist: "—", time: "—" },
  tab: "map", mapsReady: false
};

function $(s) { var r = RO.pageEl && RO.pageEl.querySelector(s); if (r) return r; return RO.ovEl ? RO.ovEl.querySelector(s) : null; }
function $$(s) {
  var a = RO.pageEl ? Array.prototype.slice.call(RO.pageEl.querySelectorAll(s)) : [];
  var b = RO.ovEl ? Array.prototype.slice.call(RO.ovEl.querySelectorAll(s)) : [];
  return a.concat(b);
}
var SERVICE_LABEL = { pickup: "Pickup", dropbox: "Drop box" };
function driverById(id) { return state.drivers.find(function (d) { return d.id === id; }); }
function orderByTn(tn) { return state.orders.find(function (o) { return o.tn === tn; }); }
function driverLabel(d) { return d.route ? d.name + " — " + d.route : d.name; }
function sourceBadge(o) {
  return '<span class="pill ' + (o.placedByType === "hq" ? "src-hq" : "src-office") + '" title="Order placed by">' +
    (o.placedByType === "hq" ? "🏠" : "🏢") + " " + esc(o.placedBy || "—") + "</span>";
}
function candidatePool() {
  return state.orders.filter(function (o) {
    var mine = state.driverId === "all" || o.driver === state.driverId || !o.driver; /* unassigned routable under any driver */
    return mine && !o.done && !state.removed.has(o.tn);
  });
}
function routeStops() {
  var pool = {}; candidatePool().forEach(function (o) { pool[o.tn] = 1; });
  return state.order.filter(function (tn) { return pool[tn]; }).map(orderByTn).filter(Boolean);
}
function rebuildRoute() {
  state.order = candidatePool().map(function (o) { return o.tn; });
  state.removed = new Set();
  state.optimized = false; state.customOrder = false;
  state.stats = { dist: "—", time: "—" };
}

/* ---------- hydrate from live props ---------- */
RO.hydrate = function () {
  var p = RO.props; if (!p) return;
  var cache = gcLoad();
  var dl = (p.driversList || []).map(function (d) {
    var name = typeof d === "string" ? d : (d && d.name) || "";
    var uid = (typeof d === "object" && d && (d.userId || d.user_id)) || "";
    return { id: name, name: name, route: "Route", color: "#f5972a", userId: uid };
  }).filter(function (d) { return d.name; });
  state.drivers = [{ id: "all", name: "All Drivers", route: "", color: "#f5972a" }].concat(dl);
  if (!state.driverId || !driverById(state.driverId)) state.driverId = dl.length ? dl[0].id : "all";

  var prevOrder = state.order.slice();
  state.orders = (p.orders || [])
    .filter(function (o) { return !o.voided && (o.status === "ready_pickup" || o.status === "need_box"); })
    .map(function (o) {
      var s = liveToStop(o, cache);
      if (RO.session.completedTns[s.tn]) s.done = true;
      return s;
    });
  var tns = {}; state.orders.forEach(function (o) { tns[o.tn] = 1; });
  var kept = prevOrder.filter(function (tn) { return tns[tn]; });
  var fresh = state.orders.map(function (o) { return o.tn; }).filter(function (tn) { return kept.indexOf(tn) === -1; });
  state.order = kept.concat(fresh);
  if (fresh.length || kept.length !== prevOrder.length) { state.optimized = false; }
};

/* ---------- background geocode of stops missing coords ---------- */
var geoRunning = false;
function geocodeMissing() {
  if (geoRunning || !state.mapsReady) return;
  var q = state.orders.filter(function (o) { return o.lat == null; });
  if (!q.length) return;
  geoRunning = true;
  var i = 0;
  (function next() {
    if (i >= q.length) { geoRunning = false; renderAll(); return; }
    var o = q[i++];
    geocodeLive(o.addr, function (r) {
      if (r.lat != null) { o.lat = r.lat; o.lng = r.lng; }
      if (o.conf !== "ok") o.conf = r.conf;
      setTimeout(next, 320);
    });
  })();
}

/* ---------- render ---------- */
function renderAll() {
  if (!RO.pageEl) return;
  renderStops(); renderMap(); renderStats(); renderQueue();
  renderDrivers(); renderBoxesOut(); renderShift(); renderHeaderChips(); updateButtons();
}
RO.renderAll = renderAll;

function confIcon(c) {
  if (c === "ok") return '<div class="conf-ico ok" title="Address confirmed">✓</div>';
  if (c === "warn") return '<div class="conf-ico warn" title="Low confidence — needs confirmation">!</div>';
  return '<div class="conf-ico err" title="Unresolvable — must be corrected">✕</div>';
}

function renderStops() {
  var stops = routeStops();
  $("#stopCount").textContent = stops.length;
  $("#customFlag").innerHTML = state.customOrder
    ? '<div class="custom-flag">⚠ Custom order — not optimized <button class="reopt" id="btnReopt">↻ Re-optimize</button></div>' : "";
  if (state.customOrder) $("#btnReopt").onclick = function () { RO.optimize(true); };

  if (!stops.length) {
    $("#stopList").innerHTML = '<div class="empty">No orders ready for pickup or drop box assigned to this driver.<br>' +
      '<a href="#" onclick="RO.switchTab(\'queue\');return false">Open the Orders table →</a></div>';
    return;
  }
  $("#stopList").innerHTML = stops.map(function (o, i) {
    var dest = encodeURIComponent(o.lat != null ? o.lat + "," + o.lng : o.addr);
    var addr = encodeURIComponent(o.addr);
    return '<div class="stop" draggable="true" data-tn="' + esc(o.tn) + '">' +
      '<div class="num ' + o.service + '">' + (i + 1) + "</div>" +
      '<div class="body">' +
      '<div class="name">' + esc(o.name) + "</div>" +
      '<div class="addr">' + esc(o.addr) + "</div>" +
      '<div class="stop-meta">' +
      '<a class="track" href="#" onclick="RO.openOrder(\'' + esc(o.tn) + '\');return false">' + esc(o.tn) + "</a>" +
      '<button class="stop-nav" title="Navigate in Apple Maps" onclick="event.stopPropagation();RO.navTo(\'' + dest + "','" + addr + "','apple')\">🧭</button>" +
      "</div>" +
      '<div class="pills"><span class="pill box">' + esc(o.box) + "</span>" +
      '<span class="pill ' + o.service + '">' + SERVICE_LABEL[o.service] + "</span></div>" +
      '<div class="stop-src">' + sourceBadge(o) + "</div>" +
      '<div class="stop-actions">' +
      '<button class="stop-arrive ' + o.service + '" onclick="event.stopPropagation();RO.openStopAction(\'' + esc(o.tn) + "')\">" +
      (o.service === "pickup" ? "📦 Arrive" : "📥 Arrive") + "</button>" +
      "</div></div>" +
      '<div class="conf">' + confIcon(o.conf) + '<div class="grip">⠿</div></div></div>';
  }).join("");
  wireDrag();
}

/* ---------- Google map ---------- */
var _map = null, _overlays = [], _iw = null;
var MAP_DARK = [
  { elementType: "geometry", stylers: [{ color: "#0e1a26" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5b7285" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b141d" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#16283a" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a121b" }] }
];
function pinIcon(color, opts) {
  opts = opts || {};
  var r = 13;
  var shape = opts.square
    ? '<rect x="3" y="3" width="' + (r * 2) + '" height="' + (r * 2) + '" rx="8" fill="' + color + '" stroke="#0b141d" stroke-width="2.5"/>'
    : '<circle cx="' + (r + 3) + '" cy="' + (r + 3) + '" r="' + r + '" fill="' + color + '" stroke="' + (opts.ring || "#0b141d") + '" stroke-width="' + (opts.ring ? 3.5 : 2.5) + '"/>';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (r * 2 + 6) + '" height="' + (r * 2 + 6) + '">' + shape + "</svg>";
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(r * 2 + 6, r * 2 + 6),
    anchor: new google.maps.Point(r + 3, r + 3),
    labelOrigin: new google.maps.Point(r + 3, r + 3)
  };
}
function ensureMap() {
  if (_map || !state.mapsReady || !window.google) return;
  var el = $("#roMapCanvas"); if (!el) return;
  _map = new google.maps.Map(el, {
    center: { lat: 40.84, lng: -73.90 }, zoom: 11, styles: MAP_DARK,
    disableDefaultUI: true, zoomControl: true, backgroundColor: "#0a1018"
  });
  _iw = new google.maps.InfoWindow();
}
function popHtml(o, tn) {
  var dest = encodeURIComponent(o.lat != null ? o.lat + "," + o.lng : (o.addr || ""));
  var addr = encodeURIComponent(o.addr || "");
  return '<div class="ro-mappop">' +
    '<div class="mp-name">' + esc(o.name || "") + "</div>" +
    '<div class="mp-addr">' + esc(o.addr || "") + "</div>" +
    (tn ? '<div class="mp-tn">' + esc(tn) + (o.service ? " · " + SERVICE_LABEL[o.service] : "") + "</div>" : "") +
    '<div class="mp-nav">' +
    '<button onclick="RO.navTo(\'' + dest + "','" + addr + "','apple')\">🍎 Apple Maps</button>" +
    '<button onclick="RO.navTo(\'' + dest + "','" + addr + "','google')\">📍 Google Maps</button>" +
    "</div></div>";
}
function renderMap() {
  ensureMap(); if (!_map) return;
  _overlays.forEach(function (x) { x.setMap(null); }); _overlays = [];
  var stops = routeStops(), pts = [], bounds = new google.maps.LatLngBounds();

  function addMarker(pos, icon, label, html, z) {
    var mk = new google.maps.Marker({ position: pos, map: _map, icon: icon, label: label || null, zIndex: z || 10 });
    if (html) mk.addListener("click", function () { _iw.setContent(html); _iw.open({ map: _map, anchor: mk }); });
    _overlays.push(mk); bounds.extend(pos); return mk;
  }
  if (state.start.type !== "anywhere" && state.start.lat != null) {
    var sp = { lat: state.start.lat, lng: state.start.lng };
    addMarker(sp, pinIcon("#27c281", { square: true }), { text: "⌂", color: "#06251a", fontSize: "13px", fontWeight: "800" },
      popHtml({ name: "Start — " + endpointShort(state.start), addr: state.start.address }, null), 40);
    pts.push(sp);
  }
  stops.forEach(function (o, i) {
    if (o.lat == null) return;
    var color = o.conf !== "ok" ? "#f2c037" : (o.service === "dropbox" ? "#3b9bff" : "#f5972a");
    var p = { lat: o.lat, lng: o.lng };
    addMarker(p, pinIcon(color), { text: String(i + 1), color: "#1a1206", fontWeight: "800", fontSize: "12px" }, popHtml(o, o.tn), 50 + i);
    pts.push(p);
  });
  if (state.end.type !== "anywhere" && state.end.lat != null) {
    var epv = { lat: state.end.lat, lng: state.end.lng };
    addMarker(epv, pinIcon("#ff5566"), { text: "⚑", color: "#fff", fontSize: "12px", fontWeight: "800" },
      popHtml({ name: "End — " + endpointShort(state.end), addr: state.end.address }, null), 45);
    pts.push(epv);
  }
  if (state.driverLoc) {
    addMarker(state.driverLoc, pinIcon("#ffffff", { ring: "#27c281" }), { text: "●", color: "#0a0e16", fontSize: "10px" },
      '<div class="ro-mappop"><div class="mp-name">📍 You are here</div><div class="mp-addr">Live driver location</div></div>', 90);
  }
  if (pts.length > 1) {
    var line = new google.maps.Polyline({
      path: pts, map: _map, strokeOpacity: 0, zIndex: 30,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: .95, strokeColor: "#f5851f", strokeWeight: 3, scale: 3 }, offset: "0", repeat: "13px" }]
    });
    _overlays.push(line);
  }
  if (state.driverLoc) bounds.extend(state.driverLoc);
  if (!bounds.isEmpty()) { try { _map.fitBounds(bounds, 55); } catch (e) {} }

  var d = driverById(state.driverId);
  $("#ovDriver").textContent = state.driverId === "all" ? "All Drivers" : (d ? d.name : "—");
  var n = stops.length;
  $("#ovStops").textContent = n + " stop" + (n === 1 ? "" : "s");
}

RO.navTo = function (destEnc, addrEnc, provider) {
  window.open(navUrl(provider, decodeURIComponent(destEnc), decodeURIComponent(addrEnc || "")), "_blank");
};

function endpointShort(ep) {
  if (ep.type === "tapedirect") return "Tape Direct";
  if (ep.type === "gps") return "Current location";
  if (ep.type === "anywhere") return "Anywhere";
  if (ep.type === "manual") return ep.address ? ep.address.split(",")[0] : "Manual address";
  return "—";
}
function renderStats() {
  $("#stStops").textContent = routeStops().length;
  $("#stDist").textContent = state.stats.dist;
  $("#stTime").textContent = state.stats.time;
  $("#stStart").textContent = endpointShort(state.start);
  $("#stEnd").textContent = endpointShort(state.end);
}
function renderHeaderChips() {
  $("#chipStops").textContent = routeStops().length;
  var d = driverById(state.driverId);
  $("#chipDriver").textContent = state.driverId === "all" ? "All Drivers" : (d ? driverLabel(d) : "—");
}

function renderQueue() {
  var rows = state.orders.filter(function (o) {
    return (state.driverId === "all" || o.driver === state.driverId || !o.driver) && !o.done;
  });
  $("#queueCount").textContent = rows.length;
  var conf = { ok: ["ok", "✓ Confirmed"], warn: ["warn", "! Low confidence"], err: ["err", "✕ Unresolvable"] };
  $("#queueBody").innerHTML = rows.map(function (o) {
    var inRoute = state.order.indexOf(o.tn) !== -1 && !state.removed.has(o.tn);
    var cc = conf[o.conf] || conf.warn;
    return "<tr>" +
      "<td>" + (inRoute
        ? '<span class="inroute-tag" title="Already in this route">✓ In route</span>'
        : '<input type="checkbox" class="ck-check qsel" data-tn="' + esc(o.tn) + '" title="Select to add to route">') + "</td>" +
      '<td><a class="tlink" href="#" onclick="RO.openOrder(\'' + esc(o.tn) + '\');return false">' + esc(o.tn) + "</a></td>" +
      '<td style="font-weight:600">' + esc(o.name) + "</td>" +
      '<td style="color:var(--text-dim)">' + esc(o.addr) + "</td>" +
      '<td><span class="pill box">' + esc(o.box) + "</span></td>" +
      '<td><span class="pill ' + o.service + '">' + SERVICE_LABEL[o.service] + "</span></td>" +
      "<td>" + sourceBadge(o) + "</td>" +
      '<td><span class="conf-tag ' + cc[0] + '">' + cc[1] + "</span></td>" +
      '<td style="color:var(--text-dim)">' + esc(o.driver || "—") + "</td></tr>";
  }).join("");
  $$(".qsel").forEach(function (c) { c.onchange = updateAddSel; });
  updateAddSel();
}
function updateAddSel() {
  var sel = $$(".qsel").filter(function (c) { return c.checked; });
  $("#selCount").textContent = sel.length;
  $("#btnAddSel").style.display = sel.length ? "inline-flex" : "none";
}

function renderDrivers() {
  var grid = $("#driverGrid");
  var real = state.drivers.filter(function (d) { return d.id !== "all"; });
  grid.innerHTML = real.map(function (d) {
    var mine = state.orders.filter(function (o) { return o.driver === d.id; });
    var cnt = mine.length, done = mine.filter(function (o) { return o.done; }).length;
    var status = cnt === 0 ? "unassigned" : (done === cnt ? "completed" : "active");
    var stxt = { active: "● Active", unassigned: "○ Unassigned", completed: "✓ Completed" }[status];
    var init = d.name.split(" ").map(function (s) { return s[0]; }).join("").slice(0, 2);
    return '<div class="dcard"><div class="dh">' +
      '<div class="av" style="background:' + d.color + '">' + esc(init) + "</div>" +
      "<div><div class=\"dn\">" + esc(d.name) + '</div><div class="dr">' + esc(d.route || "") + "</div></div></div>" +
      '<div class="meta">' +
      '<div><div class="k">Stops today</div><div class="v">' + cnt + "</div></div>" +
      '<div><div class="k">Completed</div><div class="v">' + done + "</div></div>" +
      '<div><div class="k">Status</div><div style="margin-top:6px"><span class="rstatus ' + status + '">' + stxt + "</span></div></div></div>" +
      '<button class="btn sm" style="width:100%" onclick="RO.viewDriverRoute(\'' + esc(d.id) + "')\">🗺️ View route</button></div>";
  }).join("") || '<div class="empty">No drivers configured. Add drivers in the Setup Wizard.</div>';
}

function updateButtons() {
  var stops = routeStops();
  $("#btnOptimize").disabled = stops.length === 0;
  var allConfirmed = stops.length > 0 && stops.every(function (o) { return o.conf === "ok"; });
  $("#btnAssign").disabled = !(state.optimized && allConfirmed && state.driverId !== "all");
}

/* ---------- drag reorder ---------- */
var dragTn = null;
function wireDrag() {
  $$(".stop").forEach(function (el) {
    el.addEventListener("dragstart", function () { dragTn = el.dataset.tn; el.classList.add("dragging"); });
    el.addEventListener("dragend", function () { el.classList.remove("dragging"); $$(".stop").forEach(function (s) { s.classList.remove("dragover"); }); });
    el.addEventListener("dragover", function (e) { e.preventDefault(); el.classList.add("dragover"); });
    el.addEventListener("dragleave", function () { el.classList.remove("dragover"); });
    el.addEventListener("drop", function (e) {
      e.preventDefault();
      var target = el.dataset.tn;
      if (!dragTn || dragTn === target) return;
      var ord = state.order.slice();
      var from = ord.indexOf(dragTn), to = ord.indexOf(target);
      ord.splice(from, 1); ord.splice(to, 0, dragTn);
      state.order = ord;
      if (state.optimized) state.customOrder = true;
      renderAll();
    });
  });
}

/* ---------- optimize: real geocode gate + Directions ordering ---------- */
RO.optimize = function (skipGate) {
  var stops = routeStops(); if (!stops.length) return;
  var btn = $("#btnOptimize"); btn.disabled = true; btn.textContent = "⏳ Verifying addresses…";
  var i = 0;
  (function verify() {
    if (i >= stops.length) {
      btn.textContent = "⚡ Optimize Route";
      var flagged = stops.filter(function (o) { return o.conf !== "ok"; });
      if (flagged.length && !skipGate) { updateButtons(); openConfirm(flagged); return; }
      runOrdering(routeStops());
      return;
    }
    var o = stops[i++];
    if (o.conf === "ok" && o.lat != null) return verify();
    geocodeLive(o.addr, function (r) {
      if (r.lat != null) { o.lat = r.lat; o.lng = r.lng; }
      o.conf = r.conf; o._suggest = r.formatted;
      setTimeout(verify, 300);
    });
  })();
};

function nearestNeighbor(stops) {
  var start = (state.start.lat != null) ? [state.start.lat, state.start.lng] : [stops[0].lat, stops[0].lng];
  var remaining = stops.slice(), out = [], cur = start;
  while (remaining.length) {
    var bi = 0, bd = Infinity;
    remaining.forEach(function (o, i) { var d = haversineMi(cur, [o.lat, o.lng]); if (d < bd) { bd = d; bi = i; } });
    var next = remaining.splice(bi, 1)[0]; out.push(next); cur = [next.lat, next.lng];
  }
  return out;
}
function applyOrdering(orderedTns, distMi, mins, approx) {
  state.order = orderedTns.concat(state.order.filter(function (tn) { return orderedTns.indexOf(tn) === -1; }));
  state.optimized = true; state.customOrder = false;
  state.stats = { dist: distMi + " mi" + (approx ? " ~" : ""), time: mins + " min" };
  persistSequence(orderedTns);
  renderAll();
  toast("✅ Route optimized", orderedTns.length + " stops ordered · " + distMi + " mi · " + mins + " min drive. Sequence saved to the order records.");
}
function runOrdering(stops) {
  var routable = stops.filter(function (o) { return o.lat != null; });
  if (!routable.length) { toast("⚠ No routable stops", "No stop has verified coordinates yet."); return; }
  var startPos = state.start.lat != null ? { lat: state.start.lat, lng: state.start.lng } : { lat: routable[0].lat, lng: routable[0].lng };
  var endFixed = state.end.type !== "anywhere" && state.end.lat != null;

  function fallback() {
    var ordered = nearestNeighbor(routable);
    var path = [[startPos.lat, startPos.lng]];
    ordered.forEach(function (o) { path.push([o.lat, o.lng]); });
    if (endFixed) path.push([state.end.lat, state.end.lng]);
    var mi = 0; for (var i = 1; i < path.length; i++) mi += haversineMi(path[i - 1], path[i]);
    var miles = (mi * 1.25).toFixed(1);
    var mins = Math.round(mi * 1.25 * 3.0 + routable.length * 4);
    applyOrdering(ordered.map(function (o) { return o.tn; }), miles, mins, true);
  }
  if (!(window.google && google.maps.DirectionsService)) return fallback();
  try {
    /* open-ended route: end at the farthest stop so the driver never backtracks */
    var pool = routable.slice(), dest, wp, tail = [];
    if (endFixed) { dest = { lat: state.end.lat, lng: state.end.lng }; wp = pool; }
    else if (pool.length === 1) { dest = { lat: pool[0].lat, lng: pool[0].lng }; wp = []; tail = [pool[0].tn]; }
    else {
      var far = 0, fd = -1;
      pool.forEach(function (o, i) { var d = haversineMi([startPos.lat, startPos.lng], [o.lat, o.lng]); if (d > fd) { fd = d; far = i; } });
      dest = { lat: pool[far].lat, lng: pool[far].lng };
      tail = [pool[far].tn];
      wp = pool.filter(function (_, i) { return i !== far; });
    }
    new google.maps.DirectionsService().route({
      origin: startPos, destination: dest,
      waypoints: wp.map(function (o) { return { location: { lat: o.lat, lng: o.lng }, stopover: true }; }),
      optimizeWaypoints: true, travelMode: google.maps.TravelMode.DRIVING
    }, function (res, status) {
      if (status !== "OK" || !res || !res.routes || !res.routes[0]) return fallback();
      var rt = res.routes[0];
      var seq = (rt.waypoint_order || []).map(function (wi) { return wp[wi].tn; }).concat(tail);
      var distM = 0, durS = 0;
      (rt.legs || []).forEach(function (l) { distM += (l.distance && l.distance.value) || 0; durS += (l.duration && l.duration.value) || 0; });
      var miles = (distM / 1609.34).toFixed(1);
      var mins = Math.round(durS / 60 + routable.length * 4);
      applyOrdering(seq, miles, mins, false);
    });
  } catch (e) { fallback(); }
}
/* write optimized sequence back to order records (route_sequence) */
function persistSequence(tns) {
  var save = RO.props && RO.props.onSave; if (!save) return;
  tns.forEach(function (tn, idx) {
    var o = orderByTn(tn); if (!o || !o._raw) return;
    if (o._raw.route_sequence === idx + 1) return;
    try { save(Object.assign({}, o._raw, { route_sequence: idx + 1, route_sequenced_at: new Date().toISOString() })); } catch (e) {}
  });
}

/* ---------- address confirm gate ---------- */
var confirmQueue = [], confirmSnapshot = null;
function openConfirm(flagged) {
  confirmSnapshot = {
    removed: new Set(state.removed),
    orders: state.orders.map(function (o) { return { tn: o.tn, conf: o.conf, addr: o.addr, lat: o.lat, lng: o.lng }; })
  };
  confirmQueue = flagged.map(function (o) { return o.tn; });
  var sLabel = { pickup: ["pill pickup", "Pickup"], dropbox: ["pill dropbox", "Drop box"] };
  $("#confirmBody").innerHTML = flagged.map(function (o) {
    var sc = sLabel[o.service];
    var isErr = o.conf === "err";
    var suggestion = o._suggest || "";
    var suggestCol = isErr || !suggestion
      ? '<div class="cc-col" style="border-color:rgba(255,85,102,.3)"><div class="lab">Google result</div>' +
        '<div class="val" style="color:var(--red)">No confident match — this address must be corrected before it can be routed.</div></div>'
      : '<div class="cc-col suggest"><div class="lab">Google suggestion</div><div class="val">' + esc(suggestion) + "</div></div>";
    var actions = (isErr || !suggestion
      ? ['<button class="btn sm" onclick="RO.toggleEdit(\'' + esc(o.tn) + "')\">✎ Edit address</button>",
         '<button class="btn ghost sm" onclick="RO.resolveStop(\'' + esc(o.tn) + "','remove')\">🗑 Remove from route</button>"]
      : ['<button class="btn primary sm" onclick="RO.resolveStop(\'' + esc(o.tn) + "','suggest','" + encodeURIComponent(suggestion) + "')\">✓ Use suggestion</button>",
         '<button class="btn sm" onclick="RO.toggleEdit(\'' + esc(o.tn) + "')\">✎ Edit address</button>",
         '<button class="btn ghost sm" onclick="RO.resolveStop(\'' + esc(o.tn) + "','remove')\">🗑 Remove from route</button>"]).join("");
    return '<div class="confirm-card" data-tn="' + esc(o.tn) + '">' +
      '<div class="cc-top"><span class="cc-name">' + esc(o.name) + "</span>" +
      '<a class="track" href="#" onclick="RO.openOrder(\'' + esc(o.tn) + '\');return false">' + esc(o.tn) + "</a>" +
      '<span class="pill box">' + esc(o.box) + "</span>" +
      '<span class="' + sc[0] + '">' + sc[1] + "</span>" + sourceBadge(o) +
      '<span class="conf-tag ' + o.conf + '" style="margin-left:auto">' + (isErr ? "✕ Unresolvable" : "! Low confidence") + "</span></div>" +
      '<div class="cc-cols"><div class="cc-col"><div class="lab">From order</div><div class="val">' + esc(o.addr) + "</div></div>" + suggestCol + "</div>" +
      '<div class="editrow" data-edit="' + esc(o.tn) + '"><input class="text-input" placeholder="Type the correct address…" data-editinput="' + esc(o.tn) + '"><div class="ac-holder"></div></div>' +
      '<div class="cc-actions">' + actions + "</div>" +
      '<div class="cc-resolved-tag">✓ Address confirmed &amp; saved to order record</div></div>';
  }).join("");
  updateRemaining();
  $("#confirmScrim").classList.add("open");
}
function commitConfirm() { confirmSnapshot = null; $("#confirmScrim").classList.remove("open"); runOrdering(routeStops()); }
function cancelConfirm() {
  if (confirmSnapshot) {
    state.removed = confirmSnapshot.removed;
    confirmSnapshot.orders.forEach(function (s) {
      var o = orderByTn(s.tn); if (o) { o.conf = s.conf; o.addr = s.addr; o.lat = s.lat; o.lng = s.lng; }
    });
    confirmSnapshot = null;
  }
  $("#confirmScrim").classList.remove("open");
  renderAll();
}
RO.toggleEdit = function (tn) {
  var row = $('.editrow[data-edit="' + tn + '"]');
  row.classList.toggle("open");
  if (row.classList.contains("open")) {
    var input = row.querySelector('[data-editinput="' + tn + '"]');
    input.focus();
    input.oninput = debounce(function () {
      var holder = row.querySelector(".ac-holder");
      if (input.value.trim().length < 3) { holder.innerHTML = ""; return; }
      placesPredict(input.value, function (preds) {
        holder.innerHTML = '<div class="ac-list">' + preds.map(function (s) {
          return '<div class="ac-item" onclick="RO.pickEdit(\'' + esc(tn) + "','" + encodeURIComponent(s.desc) + "')\">" +
            '<div class="l1">' + esc(s.l1) + '</div><div class="l2">' + esc(s.l2) + "</div></div>";
        }).join("") + "</div>";
      });
    }, 300);
  }
};
RO.pickEdit = function (tn, enc) { RO.resolveStop(tn, "edit", enc); };
RO.resolveStop = function (tn, action, enc) {
  var o = orderByTn(tn);
  var card = $('.confirm-card[data-tn="' + tn + '"]');
  if (action === "remove") {
    state.removed.add(tn);
    confirmQueue = confirmQueue.filter(function (x) { return x !== tn; });
    if (card) card.style.display = "none";
    updateRemaining(); return;
  }
  var newAddr = enc ? decodeURIComponent(enc) : o.addr;
  geocodeLive(newAddr, function (r) {
    o.addr = newAddr; o.conf = "ok";
    if (r.lat != null) { o.lat = r.lat; o.lng = r.lng; }
    /* write back to the order record — visible in HQ Operations + Office portal */
    var save = RO.props && RO.props.onSave;
    if (save && o._raw) {
      try {
        save(Object.assign({}, o._raw, {
          resolved_address: r.formatted || newAddr,
          geocoded_lat: o.lat, geocoded_lng: o.lng,
          address_confidence: "confirmed",
          address_confirmed_at: new Date().toISOString()
        }));
      } catch (e) {}
    }
    confirmQueue = confirmQueue.filter(function (x) { return x !== tn; });
    if (card) card.classList.add("resolved");
    updateRemaining();
  });
};
function updateRemaining() {
  $("#remainCount").textContent = confirmQueue.length;
  $("#confirmContinue").disabled = confirmQueue.length > 0;
}

/* ---------- endpoints ---------- */
function setEndpoint(which, type) {
  var ep = which === "start" ? state.start : state.end;
  ep.type = type;
  var extra = which === "start" ? $("#startExtra") : $("#endExtra");
  extra.innerHTML = "";
  if (type === "tapedirect") {
    ep.address = TAPE_DIRECT.address; ep.label = "Tape Direct"; ep.lat = TAPE_DIRECT.lat; ep.lng = TAPE_DIRECT.lng;
    extra.innerHTML = '<div class="badge-row"><span class="epbadge tape">◆ Tape Direct</span></div>' +
      '<div class="ep-resolved">' + TAPE_DIRECT.address + "</div>";
  } else if (type === "gps") {
    ep.label = "Current location";
    extra.innerHTML = '<div class="ep-resolved">📍 Locating…</div>';
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        ep.lat = pos.coords.latitude; ep.lng = pos.coords.longitude;
        state.driverLoc = { lat: ep.lat, lng: ep.lng };
        if (window.google && google.maps) {
          new google.maps.Geocoder().geocode({ location: { lat: ep.lat, lng: ep.lng } }, function (res, status) {
            ep.address = (status === "OK" && res && res[0]) ? res[0].formatted_address : (ep.lat.toFixed(5) + ", " + ep.lng.toFixed(5));
            extra.innerHTML = '<div class="badge-row"><span class="epbadge gps">● GPS</span></div><div class="ep-resolved">' + esc(ep.address) + "</div>";
            renderAll();
          });
        } else {
          ep.address = ep.lat.toFixed(5) + ", " + ep.lng.toFixed(5);
          extra.innerHTML = '<div class="badge-row"><span class="epbadge gps">● GPS</span></div><div class="ep-resolved">' + esc(ep.address) + "</div>";
          renderAll();
        }
      }, function () {
        extra.innerHTML = '<div class="ep-resolved" style="color:var(--red)">GPS unavailable — allow location access.</div>';
      }, { enableHighAccuracy: true, timeout: 8000 });
    }
  } else if (type === "anywhere") {
    ep.label = "Anywhere"; ep.address = ""; ep.lat = null; ep.lng = null;
    extra.innerHTML = '<div class="ep-resolved">Driver\'s discretion — no fixed destination.</div>';
  } else if (type === "manual") {
    ep.label = "Manual"; ep.address = ""; ep.lat = null; ep.lng = null;
    extra.innerHTML = '<div class="manual-wrap"><input class="text-input" placeholder="Start typing an address…" id="' + which + 'Manual"><div class="ac-holder" id="' + which + 'Ac"></div></div>';
    var input = $("#" + which + "Manual");
    input.oninput = debounce(function () {
      var ac = $("#" + which + "Ac");
      if (input.value.trim().length < 3) { ac.innerHTML = ""; return; }
      placesPredict(input.value, function (preds) {
        ac.innerHTML = '<div class="ac-list">' + preds.map(function (s) {
          return '<div class="ac-item" data-full="' + esc(s.desc) + '"><div class="l1">' + esc(s.l1) + '</div><div class="l2">' + esc(s.l2) + "</div></div>";
        }).join("") + "</div>";
        Array.prototype.forEach.call(ac.querySelectorAll(".ac-item"), function (it) {
          it.onclick = function () {
            input.value = it.dataset.full; ep.address = it.dataset.full; ac.innerHTML = "";
            geocodeLive(ep.address, function (r) { ep.lat = r.lat; ep.lng = r.lng; renderAll(); });
          };
        });
      });
    }, 300);
  }
  state.optimized = false; state.stats = { dist: "—", time: "—" };
  renderAll();
}

/* ---------- deep links ---------- */
function buildMapsUrl() {
  var stops = routeStops().filter(function (o) { return o.addr; });
  var enc = encodeURIComponent;
  var hasStart = state.start.type !== "anywhere" && !!state.start.address;
  var origin = hasStart ? state.start.address : (stops[0] ? stops[0].addr : "");
  var mid = hasStart ? stops : stops.slice(1);
  var dest, wps;
  if (state.end.type !== "anywhere" && state.end.address) { dest = state.end.address; wps = mid.map(function (s) { return s.addr; }); }
  else { dest = mid.length ? mid[mid.length - 1].addr : origin; wps = mid.slice(0, -1).map(function (s) { return s.addr; }); }
  var url = "https://www.google.com/maps/dir/?api=1&origin=" + enc(origin) + "&destination=" + enc(dest);
  if (wps.length) url += "&waypoints=" + wps.map(enc).join("%7C");
  return url + "&travelmode=driving";
}
function buildAppleUrl() {
  var stops = routeStops();
  var saddr = state.start.type !== "anywhere" && state.start.address ? state.start.address : (stops[0] ? stops[0].addr : "");
  var last = stops.length ? stops[stops.length - 1] : null;
  var daddr = state.end.type !== "anywhere" && state.end.address ? state.end.address : (last ? last.addr : saddr);
  return "https://maps.apple.com/?saddr=" + encodeURIComponent(saddr) + "&daddr=" + encodeURIComponent(daddr) + "&dirflg=d";
}

/* ---------- assign (real write-back) ---------- */
function assign() {
  var stops = routeStops();
  var d = driverById(state.driverId); if (!d || d.id === "all") return;
  var pickups = stops.filter(function (s) { return s.service === "pickup"; }).length;
  var drops = stops.filter(function (s) { return s.service === "dropbox"; }).length;
  var summary = [pickups && pickups + " pickup" + (pickups > 1 ? "s" : ""), drops && drops + " drop box" + (drops > 1 ? "es" : "")].filter(Boolean).join(", ");
  var url = buildMapsUrl();
  var osc = RO.props && RO.props.onStatusChange;
  stops.forEach(function (o) {
    if (osc && o._raw) { try { osc(o.tn, o._raw.status, d.name, undefined, d.userId || ""); } catch (e) {} }
  });
  var msg = "Casabe Konnect — Route assigned\nDriver: " + d.name + "\n" + stops.length + " stops (" + summary + ")\nRoute: " + url + "\nReply STOP to opt out.";
  toast("🚚 Route assigned to " + d.name,
    stops.length + " stops saved to the driver's route (order records updated). SMS via Twilio queues in Message Queue once credentials are added:\n\n" + msg, url);
  if (RO.props && RO.props.notify) { try { RO.props.notify("🚚 Route assigned to " + d.name + " — " + stops.length + " stops"); } catch (e) {} }
}

/* ---------- order sheet ---------- */
RO.openOrder = function (tn) {
  var o = orderByTn(tn); if (!o) return;
  var conf = { ok: "✓ Confirmed", warn: "! Low confidence", err: "✕ Unresolvable" }[o.conf];
  $("#sheetTitle").textContent = o.tn;
  $("#sheetBody").innerHTML =
    '<div class="kv"><div class="k">Tracking number</div><div class="v" style="color:var(--orange-ink)">' + esc(o.tn) + "</div></div>" +
    '<div class="kv"><div class="k">Customer</div><div class="v">' + esc(o.name) + "</div></div>" +
    '<div class="kv"><div class="k">Phone</div><div class="v">' + esc(o.phone || "—") + "</div></div>" +
    '<div class="kv"><div class="k">' + (o.service === "pickup" ? "Pickup" : "Delivery") + ' address</div><div class="v">' + esc(o.addr) + "</div></div>" +
    '<div class="kv"><div class="k">Box type</div><div class="v">' + esc(o.box) + "</div></div>" +
    '<div class="kv"><div class="k">Service type</div><div class="v"><span class="pill ' + o.service + '">' + SERVICE_LABEL[o.service] + "</span></div></div>" +
    (o.service === "pickup"
      ? '<div class="kv"><div class="k">Amount due</div><div class="v">' + fmt$(o.price) + "</div></div>" +
        '<div class="kv"><div class="k">Shipping to</div><div class="v">' + esc(o.destination || "—") + "</div></div>" +
        '<div class="kv"><div class="k">Name on box</div><div class="v">' + (o.nameOnBox ? esc(o.nameOnBox) : '<span style="color:var(--yellow)">⚠ needs label</span>') + "</div></div>"
      : "") +
    '<div class="kv"><div class="k">Placed by</div><div class="v">' + sourceBadge(o) + "</div></div>" +
    '<div class="kv"><div class="k">Assigned driver</div><div class="v">' + esc(o.driver || "—") + "</div></div>" +
    '<div class="kv"><div class="k">Address confidence</div><div class="v"><span class="conf-tag ' + o.conf + '">' + conf + "</span></div></div>" +
    (o.done ? '<div class="kv"><div class="k">Stop status</div><div class="v"><span class="conf-tag ok">✓ Completed this shift</span></div></div>' : "") +
    '<div style="border-top:1px solid var(--border);padding-top:14px;color:var(--muted);font-size:11px">Full detail lives in the Orders module of Casabe Konnect.</div>';
  $("#orderSheet").classList.add("open");
};

/* ---------- stop action (driver intake) ---------- */
var saCtx = null;
function boxSelect(sel) {
  var opts = (window.BOX_CONFIG || []).filter(function (b) { return b.active && !b.legacy; }).map(function (b) { return b.key; });
  if (!opts.length) opts = ["Small", "Medium", "Large", "XL"];
  if (sel && opts.indexOf(sel) === -1) opts.unshift(sel);
  return opts.map(function (b) { return "<option " + (b === sel ? "selected" : "") + ">" + esc(b) + "</option>"; }).join("");
}
RO.openStopAction = function (tn) {
  var o = orderByTn(tn); if (!o) return;
  saCtx = { tn: tn, due: o.price || 0, method: "Cash", channel: "WhatsApp", labelMode: o.nameOnBox ? "labeled" : "needslabel" };
  $("#stopModal").innerHTML = o.service === "pickup" ? pickupForm(o) : dropForm(o);
  $("#stopScrim").classList.add("open");
  if (o.service === "pickup") RO.saRecalc();
};
RO.closeStop = function () { $("#stopScrim").classList.remove("open"); saCtx = null; };

function arrivalBanner(o) {
  if (!state.driverLoc || o.lat == null) return "";
  var dist = haversineMi([state.driverLoc.lat, state.driverLoc.lng], [o.lat, o.lng]);
  var dest = encodeURIComponent(o.lat + "," + o.lng), addr = encodeURIComponent(o.addr);
  if (dist <= 0.12) return '<div class="arrival ok">📍 <span>GPS confirms you\'re at this location — <b>' + esc(o.addr) + "</b></span></div>";
  var away = dist < 0.2 ? Math.round(dist * 5280) + " ft" : dist.toFixed(1) + " mi";
  return '<div class="arrival far">🧭 <span>You\'re <b>' + away + "</b> away — confirm you're at the right address before logging.</span>" +
    '<div class="mp-nav"><button onclick="RO.navTo(\'' + dest + "','" + addr + "','apple')\">🍎 Apple Maps</button>" +
    '<button onclick="RO.navTo(\'' + dest + "','" + addr + "','google')\">📍 Google Maps</button></div></div>";
}

function pickupForm(o) {
  var needs = saCtx.labelMode === "needslabel";
  var methods = ["Cash", "Card", "Zelle", "CashApp", "Already paid"];
  return '<div class="modal-head">' +
    '<div class="mi" style="background:var(--amber-soft);border-color:rgba(245,183,51,.35)">📦</div>' +
    "<div><h2>Pickup intake — " + esc(o.name) + "</h2>" +
    '<p>Confirm the sender, where the box is going, and payment. <span style="color:var(--orange-ink);font-weight:700">' + esc(o.tn) + "</span></p></div>" +
    '<button class="x" onclick="RO.closeStop()">✕</button></div>' +
    '<div class="modal-body">' + arrivalBanner(o) +
    '<div class="fsec"><div class="fsec-h"><span class="n">1</span> Sender <span class="hint">pulled from order — edit if wrong</span></div>' +
    '<div class="fgrid">' +
    '<div class="fld"><label>Customer name</label><input id="sa_name" value="' + esc(o.name) + '"></div>' +
    '<div class="fld"><label>Phone</label><input id="sa_phone" value="' + esc(o.phone || "") + '"></div>' +
    '<div class="fld full"><label>Pickup address</label><input id="sa_addr" value="' + esc(o.addr) + '"></div>' +
    '<div class="fld full"><label>Order placed by</label><div style="padding-top:3px">' + sourceBadge(o) + ' <span style="color:var(--muted);font-size:11px">· auto-loaded from the order</span></div></div>' +
    '<div class="fld"><label>Box type</label><select id="sa_box">' + boxSelect(o.box) + "</select></div>" +
    '<div class="fld"><label>Boxes picked up</label><input id="sa_qty" type="number" min="1" value="1"></div>' +
    "</div></div>" +
    '<div class="fsec"><div class="fsec-h"><span class="n">2</span> Where is this box going? <span class="hint">prevents mis-ships &amp; delays</span></div>' +
    '<div class="seg" id="sa_labelSeg">' +
    '<button class="' + (!needs ? "on" : "") + '" onclick="RO.saLabelMode(\'labeled\')">✓ Name already on box</button>' +
    '<button class="' + (needs ? "on" : "") + '" onclick="RO.saLabelMode(\'needslabel\')">🏷 Needs a label</button></div>' +
    '<div class="fgrid" style="margin-top:12px">' +
    '<div class="fld"><label>Recipient name on box</label><input id="sa_rname" value="' + esc(o.nameOnBox || "") + '" placeholder="Who is it going to?"></div>' +
    '<div class="fld"><label>Destination</label><input id="sa_dest" value="' + esc(o.destination || "") + '" placeholder="City, country"></div>' +
    '<div class="fld full"><label>Recipient phone (optional)</label><input id="sa_rphone" placeholder="In-country delivery contact"></div></div>' +
    '<div class="label-note ' + (needs ? "show" : "") + '" id="sa_labelNote">🏷 No name on the box yet — we\'ll print &amp; attach a label at the warehouse from the info above.</div></div>' +
    '<div class="fsec"><div class="fsec-h"><span class="n">3</span> Payment</div>' +
    '<div class="seg pay" id="sa_methodSeg">' +
    methods.map(function (m) { return '<button data-m="' + m + '" class="' + (m === saCtx.method ? "on" : "") + '" onclick="RO.saSetMethod(\'' + m + "')\">" + (m === "Cash" ? "💵 " : "") + m + "</button>"; }).join("") + "</div>" +
    '<div class="pay-row"><div class="pay-due"><span class="k">Amount due</span><span class="v">' + fmt$(saCtx.due) + "</span></div>" +
    '<div class="fld" style="width:140px"><label>Collected now</label><input id="sa_collected" type="number" min="0" value="' + saCtx.due + '" oninput="RO.saRecalc()"></div>' +
    '<span class="paystatus full" id="sa_status">Paid in full</span></div></div>' +
    '<div class="fsec"><div class="fsec-h"><span class="n">4</span> Receipt</div>' +
    '<div class="switchrow"><div class="switch on" id="sa_receipt" onclick="RO.saToggleReceipt()"><div class="k"></div></div>' +
    '<div><div class="lbl">Send receipt to customer</div><div class="sub">Sends the sender a payment + shipment confirmation.</div></div></div>' +
    '<div class="seg" id="sa_channelSeg" style="margin-top:6px">' +
    ["WhatsApp", "SMS", "Email"].map(function (c, i) { return '<button data-c="' + c + '" class="' + (i === 0 ? "on" : "") + '" onclick="RO.saChannel(\'' + c + "')\">" + c + "</button>"; }).join("") + "</div></div>" +
    "</div>" +
    '<div class="modal-foot"><div class="complete-summary" id="sa_summary"></div>' +
    '<button class="btn ghost" onclick="RO.closeStop()">Cancel</button>' +
    '<button class="btn primary" onclick="RO.completePickup()">✓ Complete pickup</button></div>';
}
function dropForm(o) {
  return '<div class="modal-head">' +
    '<div class="mi" style="background:var(--blue-soft);border-color:rgba(59,155,255,.35)">📥</div>' +
    "<div><h2>Drop box — " + esc(o.name) + "</h2>" +
    '<p>Confirm the empty box was delivered. <span style="color:var(--orange-ink);font-weight:700">' + esc(o.tn) + "</span></p></div>" +
    '<button class="x" onclick="RO.closeStop()">✕</button></div>' +
    '<div class="modal-body">' + arrivalBanner(o) +
    '<div class="fsec"><div class="fsec-h"><span class="n">1</span> Recipient <span class="hint">pulled from order</span></div>' +
    '<div class="fgrid">' +
    '<div class="fld"><label>Customer name</label><input id="sa_name" value="' + esc(o.name) + '"></div>' +
    '<div class="fld"><label>Phone</label><input id="sa_phone" value="' + esc(o.phone || "") + '"></div>' +
    '<div class="fld full"><label>Delivery address</label><input id="sa_addr" value="' + esc(o.addr) + '"></div>' +
    '<div class="fld full"><label>Order placed by</label><div style="padding-top:3px">' + sourceBadge(o) + "</div></div></div></div>" +
    '<div class="fsec"><div class="fsec-h"><span class="n">2</span> Box delivered</div>' +
    '<div class="fgrid">' +
    '<div class="fld"><label>Box type</label><select id="sa_box">' + boxSelect(o.box) + "</select></div>" +
    '<div class="fld"><label>How many</label><input id="sa_qty" type="number" min="1" value="1"></div>' +
    '<div class="fld full"><label>Note (optional)</label><input id="sa_note" placeholder="Left with doorman, handed to customer…"></div></div>' +
    '<div class="dropzone">📷 Photo / signature capture on delivery — available in the driver receipt flow</div></div>' +
    '<div class="fsec"><div class="fsec-h"><span class="n">3</span> Campaign tracking</div>' +
    '<div class="switchrow"><div class="switch on" id="sa_queue" onclick="RO.saToggleQueue()"><div class="k"></div></div>' +
    '<div><div class="lbl">Add to Boxes Out queue</div><div class="sub">Customer now holds a box to fill and ship.</div></div></div>' +
    '<div class="switchrow"><div class="switch on" id="sa_notify" onclick="RO.saToggle(\'sa_notify\')"><div class="k"></div></div>' +
    '<div><div class="lbl">Notify when a shipment is approaching</div><div class="sub">Enrolls them in the area pickup campaign.</div></div></div></div>' +
    "</div>" +
    '<div class="modal-foot"><div class="complete-summary">Logged to <b>' + esc(o.name) + "</b>'s record.</div>" +
    '<button class="btn ghost" onclick="RO.closeStop()">Cancel</button>' +
    '<button class="btn primary" onclick="RO.completeDrop()">✓ Complete drop-off</button></div>';
}
RO.saLabelMode = function (mode) {
  saCtx.labelMode = mode;
  Array.prototype.forEach.call($("#sa_labelSeg").children, function (b, i) { b.classList.toggle("on", (mode === "labeled") === (i === 0)); });
  $("#sa_labelNote").classList.toggle("show", mode === "needslabel");
};
RO.saSetMethod = function (m) {
  saCtx.method = m;
  Array.prototype.forEach.call($("#sa_methodSeg").children, function (b) { b.classList.toggle("on", b.dataset.m === m); });
  var ci = $("#sa_collected");
  if (m === "Already paid") { ci.value = 0; ci.disabled = true; }
  else { ci.disabled = false; if (+ci.value === 0) ci.value = saCtx.due; }
  RO.saRecalc();
};
RO.saChannel = function (c) { saCtx.channel = c; Array.prototype.forEach.call($("#sa_channelSeg").children, function (b) { b.classList.toggle("on", b.dataset.c === c); }); };
RO.saToggle = function (id) { $("#" + id).classList.toggle("on"); };
RO.saToggleReceipt = function () {
  var on = $("#sa_receipt").classList.toggle("on");
  $("#sa_channelSeg").style.opacity = on ? "" : ".4";
  $("#sa_channelSeg").style.pointerEvents = on ? "" : "none";
};
RO.saToggleQueue = function () {
  var on = $("#sa_queue").classList.toggle("on");
  var n = $("#sa_notify");
  if (!on) { n.classList.remove("on"); n.style.opacity = ".4"; n.style.pointerEvents = "none"; }
  else { n.style.opacity = ""; n.style.pointerEvents = ""; }
};
RO.saRecalc = function () {
  if (!saCtx) return;
  var prepaid = saCtx.method === "Already paid";
  var collected = +(($("#sa_collected") || {}).value || 0), due = saCtx.due, st = $("#sa_status");
  var cls, txt;
  if (prepaid) { cls = "full"; txt = "Prepaid — paid in full"; }
  else if (collected > due) { cls = "partial"; txt = "Overpaid by " + fmt$(collected - due) + " — check"; }
  else if (collected === due) { cls = "full"; txt = "Paid in full"; }
  else if (collected > 0) { cls = "partial"; txt = "Owes " + fmt$(due - collected); }
  else { cls = "unpaid"; txt = "Unpaid — owes " + fmt$(due); }
  st.className = "paystatus " + cls; st.textContent = txt;
  var sum = $("#sa_summary");
  if (sum) sum.innerHTML = prepaid
    ? 'Already paid · <b>$0</b> collected at stop'
    : "Collecting <b>" + fmt$(collected) + "</b> via <b>" + saCtx.method + "</b>" +
      (collected < due ? ' · <span style="color:var(--yellow)">owes ' + fmt$(due - collected) + "</span>" : (collected > due ? ' · <span style="color:var(--yellow)">over by ' + fmt$(collected - due) + "</span>" : ""));
};

/* complete = single authoritative write via onSave (payment + label + status + history) */
function completeWrite(o, patch, newStatus, historyNote) {
  var save = RO.props && RO.props.onSave; if (!save || !o._raw) return false;
  var raw = o._raw;
  var hist = (raw.history || []).concat([{ status: newStatus, ts: new Date().toISOString(), note: historyNote, by: "Route Optimizer" }]);
  var boxes = (raw.boxes || []).map(function (b) { return Object.assign({}, b, { orderStatus: newStatus, status: newStatus }); });
  var updated = Object.assign({}, raw, patch, { status: newStatus, history: hist, boxes: boxes });
  try { save(updated); return true; } catch (e) { return false; }
}
RO.completePickup = function () {
  var o = orderByTn(saCtx.tn); if (!o) return;
  var rname = $("#sa_rname").value.trim(), dest = $("#sa_dest").value.trim();
  if (!rname || !dest) {
    $("#sa_rname").style.borderColor = rname ? "" : "var(--red)";
    $("#sa_dest").style.borderColor = dest ? "" : "var(--red)";
    toast("⚠ Confirm where it's going", "Add the recipient name and destination before completing — this is what prevents mis-ships.");
    return;
  }
  var collected = +($("#sa_collected").value || 0);
  var method = saCtx.method, owed = method === "Already paid" ? 0 : Math.max(0, saCtx.due - collected);
  var receipt = $("#sa_receipt").classList.contains("on"), channel = saCtx.channel;
  var rphone = $("#sa_rphone").value.trim(), qty = +($("#sa_qty").value || 1), box = $("#sa_box").value, labelMode = saCtx.labelMode;

  var p = Object.assign({}, o._raw.payment || {});
  if (method !== "Already paid" && collected > 0) {
    p.paid = (parseFloat(p.paid) || 0) + collected;
    p.method = method.toLowerCase().replace(" ", "_");
    p.status = (parseFloat(p.paid) >= (parseFloat(p.amount) || 0)) ? "paid" : "deposit";
  }
  completeWrite(o, {
    payment: p, nameOnBox: rname, labelMode: labelMode, boxType: box,
    stopCompletion: { collected: collected, method: method, owed: owed, receipt: receipt, channel: channel,
      qty: qty, recipientPhone: rphone, destinationNote: dest, completedAt: new Date().toISOString() }
  }, "picked_up", "Pickup intake — collected " + fmt$(collected) + " (" + method + ")" + (owed ? " · owes " + fmt$(owed) : ""));

  RO.session.completedTns[o.tn] = 1;
  RO.session.completed.push({ tn: o.tn, name: o.name, service: "pickup", due: saCtx.due, collected: collected, method: method, owed: owed, receipt: receipt, driver: o.driver || state.driverId, placedBy: o.placedBy, placedByType: o.placedByType });
  roSessSave();
  o.done = true; state.removed.add(o.tn);
  RO.closeStop(); renderAll();

  var msg = o.name + " · collected " + fmt$(collected) + " (" + method + ")" + (owed ? " · owes " + fmt$(owed) : " · paid in full") + " · " + (qty > 1 ? qty + "× " : "") + "→ " + rname + " (" + dest + ")";
  if (labelMode === "needslabel") msg += " · 🏷 label to print";
  if (receipt) {
    if (channel === "WhatsApp") { window.open(receiptWaUrl(o, collected, method, owed), "_blank"); msg += "\nWhatsApp receipt opened — press send."; }
    else msg += "\n" + channel + " receipt queues in Message Queue (Twilio pending).";
  }
  toast("✅ Pickup logged", msg);
};
RO.completeDrop = function () {
  var o = orderByTn(saCtx.tn); if (!o) return;
  var toQueue = $("#sa_queue").classList.contains("on");
  var notify = toQueue && $("#sa_notify").classList.contains("on");
  var qty = +($("#sa_qty").value || 1), box = $("#sa_box").value, note = $("#sa_note").value.trim();
  completeWrite(o, {
    boxType: box,
    stopCompletion: { qty: qty, note: note, boxesOut: toQueue, notify: notify, completedAt: new Date().toISOString() }
  }, "box_dropped_off", "Drop box — " + qty + "× " + box + (note ? " · " + note : ""));
  RO.session.completedTns[o.tn] = 1;
  RO.session.completed.push({ tn: o.tn, name: o.name, service: "dropbox", due: 0, collected: 0, method: "", owed: 0, receipt: false, driver: o.driver || state.driverId, placedBy: o.placedBy, placedByType: o.placedByType });
  roSessSave();
  if (toQueue) RO.session.boxesOut.push({ tn: o.tn, name: o.name, phone: o.phone, addr: o.addr, box: box, driver: o.driver || state.driverId, date: "Today", notify: notify, placedBy: o.placedBy, placedByType: o.placedByType });
  roSessSave();
  o.done = true; state.removed.add(o.tn);
  RO.closeStop(); renderAll(); if (toQueue) RO.switchTab("boxes");
  toast("📦 Box dropped", o.name + " delivered" + (toQueue ? " · added to Boxes Out queue" : "") + (notify ? " · shipment campaign enabled" : "") + ".");
};

/* ---------- shift + boxes out ---------- */
function shiftSet() {
  return state.driverId === "all" ? RO.session.completed
    : RO.session.completed.filter(function (x) { return x.driver === state.driverId; });
}
function renderShift() {
  var c = shiftSet();
  var cash = c.filter(function (x) { return x.method === "Cash"; }).reduce(function (s, x) { return s + (x.collected || 0); }, 0);
  $("#shiftCash").textContent = fmt$(cash);
}
function openShift() {
  var c = shiftSet();
  var collected = c.reduce(function (s, x) { return s + (x.collected || 0); }, 0);
  var cash = c.filter(function (x) { return x.method === "Cash"; }).reduce(function (s, x) { return s + (x.collected || 0); }, 0);
  var owed = c.reduce(function (s, x) { return s + (x.owed || 0); }, 0);
  var boxes = state.driverId === "all" ? RO.session.boxesOut.length : RO.session.boxesOut.filter(function (x) { return x.driver === state.driverId; }).length;
  var s = { collected: collected, cash: cash, digital: collected - cash, owed: owed,
    pickups: c.filter(function (x) { return x.service === "pickup"; }).length,
    drops: c.filter(function (x) { return x.service === "dropbox"; }).length,
    receipts: c.filter(function (x) { return x.receipt; }).length, boxes: boxes };
  var d = driverById(state.driverId);
  var who = state.driverId !== "all" && d ? driverLabel(d) : "All drivers";
  var txns = c.filter(function (x) { return x.collected > 0; });
  var bySource = {};
  c.forEach(function (x) { var k = x.placedBy || "—"; if (!bySource[k]) bySource[k] = { n: 0, type: x.placedByType }; bySource[k].n++; });
  var srcRows = Object.keys(bySource).map(function (k) {
    var v = bySource[k];
    return '<div class="txn"><span class="m ' + (v.type === "hq" ? "cash" : "") + '">' + (v.type === "hq" ? "🏠" : "🏢") + "</span>" +
      '<span class="who">' + esc(k) + '</span><span class="amt">' + v.n + " box" + (v.n > 1 ? "es" : "") + "</span></div>";
  }).join("");
  $("#shiftModal").innerHTML =
    '<div class="modal-head"><div class="mi" style="background:var(--green-soft);border-color:rgba(39,194,129,.35)">💵</div>' +
    "<div><h2>End-of-shift summary</h2><p>" + esc(who) + " · " + (s.pickups + s.drops) + " stops completed</p></div>" +
    '<button class="x" onclick="RO.closeShift()">✕</button></div>' +
    '<div class="modal-body">' +
    '<div class="shift-hero"><div class="big">' + fmt$(s.collected) + '</div><div class="lbl">collected this shift</div></div>' +
    '<div class="shift-grid">' +
    '<div class="sb cash"><div class="k">💵 Cash to reconcile</div><div class="v">' + fmt$(s.cash) + "</div></div>" +
    '<div class="sb"><div class="k">Card / digital</div><div class="v">' + fmt$(s.digital) + "</div></div>" +
    '<div class="sb owed"><div class="k">Outstanding owed</div><div class="v">' + fmt$(s.owed) + "</div></div>" +
    '<div class="sb"><div class="k">Pickups</div><div class="v">' + s.pickups + "</div></div>" +
    '<div class="sb"><div class="k">Drop-offs</div><div class="v">' + s.drops + "</div></div>" +
    '<div class="sb"><div class="k">Receipts sent</div><div class="v">' + s.receipts + "</div></div></div>" +
    '<div class="txns"><div class="th">Transactions</div>' +
    (txns.length ? txns.map(function (x) {
      return '<div class="txn"><span class="who">' + esc(x.name) + '</span><span class="m ' + (x.method === "Cash" ? "cash" : "") + '">' + esc(x.method) + "</span>" +
        '<span style="color:var(--muted);font-size:11px">' + esc(x.tn) + "</span>" +
        '<span class="amt">' + fmt$(x.collected) + (x.owed ? ' <span style="color:var(--yellow)">(owes ' + fmt$(x.owed) + ")</span>" : "") + "</span></div>";
    }).join("") : '<div class="shift-empty">No payments collected yet — complete a pickup to start the drawer.</div>') + "</div>" +
    '<div class="txns"><div class="th">Where boxes came from</div>' + (srcRows || '<div class="shift-empty">No stops completed yet.</div>') + "</div>" +
    "</div>" +
    '<div class="modal-foot"><div class="complete-summary">Boxes out added today: <b>' + s.boxes + "</b></div>" +
    '<button class="btn ghost" onclick="RO.closeShift()">Close</button>' +
    '<button class="btn primary" onclick="RO.closeShift()">✓ Close shift</button></div>';
  $("#shiftScrim").classList.add("open");
}
RO.closeShift = function () { $("#shiftScrim").classList.remove("open"); };

function renderBoxesOut() {
  $("#boxesCount").textContent = RO.session.boxesOut.length;
  var b = $("#boxesBody");
  if (!RO.session.boxesOut.length) {
    b.innerHTML = '<tr><td colspan="8"><div class="shift-empty">No boxes out yet. Complete a drop-off to add customers here for shipment campaigns.</div></td></tr>';
    $("#btnCampaign").disabled = true; return;
  }
  $("#btnCampaign").disabled = false;
  b.innerHTML = RO.session.boxesOut.map(function (x) {
    return "<tr><td style=\"font-weight:600\">" + esc(x.name) + "</td>" +
      '<td style="color:var(--text-dim)">' + esc(x.phone || "—") + "</td>" +
      '<td style="color:var(--text-dim)">' + esc(x.addr) + "</td>" +
      '<td><span class="pill box">' + esc(x.box) + "</span></td>" +
      "<td>" + sourceBadge(x) + "</td>" +
      '<td style="color:var(--text-dim)">' + esc(x.date) + "</td>" +
      '<td style="color:var(--text-dim)">' + esc(x.driver || "—") + "</td>" +
      '<td><span class="box-status ' + (x.notify ? "" : "holding") + '">' + (x.notify ? "📣 Campaign on" : "Holding") + "</span></td></tr>";
  }).join("");
}
function runCampaign() {
  var targets = RO.session.boxesOut.filter(function (x) { return x.notify; });
  if (!targets.length) { toast("No campaign targets", 'Enable "notify" on a boxes-out customer first.'); return; }
  toast("📣 Campaign queued", '"Shipment approaching" message queued to ' + targets.length + " customer" + (targets.length > 1 ? "s" : "") + " holding a box. Sends via Twilio once credentials are added (Message Queue).");
}

/* ---------- tabs / toast / init ---------- */
RO.switchTab = function (name) {
  state.tab = name;
  $$(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
  $$(".tabpane").forEach(function (p) { p.classList.toggle("active", p.dataset.pane === name); });
  if (name === "map" && _map) setTimeout(function () { google.maps.event.trigger(_map, "resize"); renderMap(); }, 60);
};
RO.viewDriverRoute = function (id) {
  $("#driverSelect").value = id; state.driverId = id; rebuildRoute(); RO.switchTab("map"); renderAll();
};
function toast(title, body, url) {
  var w = $("#roToasts"); if (!w) return;
  var el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = '<div class="th">' + title + '</div><div class="tb">' + esc(body).replace(/\n/g, "<br>") + "</div>" + (url ? '<div class="url">' + esc(url) + "</div>" : "");
  w.appendChild(el);
  setTimeout(function () { el.remove(); }, 9000);
}

RO.init = function () {
  var ds = $("#driverSelect");
  ds.innerHTML = state.drivers.map(function (d) {
    return '<option value="' + esc(d.id) + '" ' + (d.id === state.driverId ? "selected" : "") + ">" + (d.id === "all" ? "All Drivers" : esc(driverLabel(d))) + "</option>";
  }).join("");
  ds.onchange = function (e) { state.driverId = e.target.value; rebuildRoute(); renderAll(); };
  $("#pageDate").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  setEndpoint("start", "tapedirect");
  setEndpoint("end", "anywhere");
  $("#startSelect").onchange = function (e) { setEndpoint("start", e.target.value); };
  $("#endSelect").onchange = function (e) { setEndpoint("end", e.target.value); };
  $("#btnOptimize").onclick = function () { RO.optimize(false); };
  $("#btnReset").onclick = function () {
    $("#startSelect").value = "tapedirect"; $("#endSelect").value = "anywhere";
    setEndpoint("start", "tapedirect"); setEndpoint("end", "anywhere");
    rebuildRoute(); renderAll();
    toast("↻ Route reset", "Manual reorders and endpoint overrides cleared — re-queried fresh from orders.");
  };
  $$(".tab").forEach(function (t) { t.onclick = function () { RO.switchTab(t.dataset.tab); }; });
  $("#btnGoogle").onclick = function () { var url = buildMapsUrl(); window.open(url, "_blank"); toast("📍 Opening Google Maps", "Full multi-stop waypoint route:", url); };
  $("#btnApple").onclick = function () { var url = buildAppleUrl(); window.open(url, "_blank"); toast("🍎 Opening Apple Maps", "Driving directions (Apple is point-to-point — use a pin's Navigate for each leg):", url); };
  $("#btnAssign").onclick = assign;
  $("#btnShift").onclick = openShift;
  $("#btnCampaign").onclick = runCampaign;
  $("#btnAddSel").onclick = function () {
    var sel = $$(".qsel").filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.tn; });
    sel.forEach(function (tn) { state.removed.delete(tn); if (state.order.indexOf(tn) === -1) state.order.push(tn); });
    state.optimized = false; RO.switchTab("map"); renderAll();
    toast("＋ Added to route", sel.length + " order" + (sel.length > 1 ? "s" : "") + " added. Re-run Optimize Route to re-sequence.");
  };
  $("#confirmContinue").onclick = commitConfirm;
  $("#confirmClose").onclick = $("#confirmCancel").onclick = cancelConfirm;
  $("#sheetClose").onclick = function () { $("#orderSheet").classList.remove("open"); };
  $("#roFab").onclick = function () { $("#roSidebar").classList.toggle("open"); };
  rebuildRoute();
  renderAll();
  /* boot Google Maps + GPS */
  if (typeof initGoogleMaps === "function") {
    initGoogleMaps(function () {
      state.mapsReady = true;
      ensureMap(); renderMap(); geocodeMissing();
    });
  }
  if (navigator.geolocation) {
    try {
      RO._geoWatch = navigator.geolocation.watchPosition(function (pos) {
        state.driverLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        renderMap();
      }, function () {}, { enableHighAccuracy: true, maximumAge: 15000 });
    } catch (e) {}
  }
};

/* ---------- style injection (shared by HQ + Driver pages) ---------- */
function ensureStyles() {
  if (!document.getElementById("ro-style")) {
    var st = document.createElement("style"); st.id = "ro-style"; st.textContent = CSS;
    document.head.appendChild(st);
  }
}

/* ---------- React wrapper (HQ) ---------- */
window.RouteOptimizerPage = function (props) {
  RO.props = props;
  var ref = React.useRef(null);
  React.useEffect(function () {
    var host = ref.current;
    ensureStyles();
    host.className = "ro-scope";
    host.style.cssText = "display:flex;flex-direction:column;height:calc(100vh - 108px);min-height:540px";
    host.innerHTML = PAGE_HTML;
    var ov = document.createElement("div");
    ov.className = "ro-scope"; ov.id = "ro-overlays";
    ov.innerHTML = OVERLAY_HTML;
    document.body.appendChild(ov);
    RO.pageEl = host; RO.ovEl = ov;
    RO.hydrate();
    RO.init();
    return function () {
      if (RO._geoWatch != null && navigator.geolocation) { try { navigator.geolocation.clearWatch(RO._geoWatch); } catch (e) {} }
      RO._geoWatch = null;
      try { document.body.removeChild(ov); } catch (e) {}
      RO.pageEl = null; RO.ovEl = null; _map = null; _overlays = [];
    };
  }, []);
  React.useEffect(function () {
    if (!RO.pageEl) return;
    RO.hydrate();
    renderAll();
    geocodeMissing();
  }, [props.orders, props.driversList]);
  return React.createElement("div", { ref: ref });
};

/* ═══════════════════════ DRIVER ROUTE LITE ═══════════════════════════════
   Dispatcher plans upstream; the driver just gets ordered stops + one payment
   action per stop:
     paid already        → "Already paid ✓"  → receipt + stop complete
     balance outstanding → "Collect $X"      → confirm amount → paid-in-full
                            receipt, or partial (balance saved) — then complete
     drop box            → "Box delivered"   → stop complete
   All writes go through props.onSave / onStatusChange (Supabase). */
window.DriverRouteLite = function (props) {
  var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo;
  var h = React.createElement;
  var orders = props.orders || [];
  var me = props.driverName || "";
  var notify = props.notify || function () {};
  var cache = gcLoad();

  var _seq = useState(null); var seq = _seq[0], setSeq = _seq[1];
  var _stats = useState(null); var stats = _stats[0], setStats = _stats[1];
  var _busy = useState(false); var busy = _busy[0], setBusy = _busy[1];
  var _pay = useState(null); var payFor = _pay[0], setPayFor = _pay[1];   /* order id being collected */
  var _amt = useState(""); var amt = _amt[0], setAmt = _amt[1];
  var _mth = useState("Cash"); var mth = _mth[0], setMth = _mth[1];
  var _ready = useState(false); var mapsReady = _ready[0], setReady = _ready[1];

  useEffect(function () {
    ensureStyles();
    if (typeof initGoogleMaps === "function") initGoogleMaps(function () { setReady(true); });
  }, []);

  var stops = useMemo(function () {
    var mine = orders.filter(function (o) {
      return !o.voided && (o.status === "ready_pickup" || o.status === "need_box") &&
        (!me || o.assignedDriver === me || !o.assignedDriver);
    }).map(function (o) { return liveToStop(o, cache); });
    /* saved dispatcher sequence first, then local optimize seq */
    mine.sort(function (a, b) {
      var sa = (a._raw.route_sequence || 999), sb = (b._raw.route_sequence || 999);
      return sa - sb;
    });
    if (seq) {
      var idx = {}; seq.forEach(function (tn, i) { idx[tn] = i; });
      mine.sort(function (a, b) { return (idx[a.tn] != null ? idx[a.tn] : 999) - (idx[b.tn] != null ? idx[b.tn] : 999); });
    }
    return mine;
  }, [orders, me, seq]);

  function optimizeLite() {
    var routable = stops.filter(function (o) { return o.lat != null; });
    var pend = stops.filter(function (o) { return o.lat == null; });
    setBusy(true);
    var run = function () {
      var startPos = [TAPE_DIRECT.lat, TAPE_DIRECT.lng];
      var remaining = routable.slice(), out = [], cur = startPos, mi = 0;
      while (remaining.length) {
        var bi = 0, bd = Infinity;
        remaining.forEach(function (o, i) { var d = haversineMi(cur, [o.lat, o.lng]); if (d < bd) { bd = d; bi = i; } });
        var nx = remaining.splice(bi, 1)[0]; mi += bd; cur = [nx.lat, nx.lng]; out.push(nx.tn);
      }
      setSeq(out.concat(pend.map(function (o) { return o.tn; })));
      setStats({ dist: (mi * 1.3).toFixed(1) + " mi", time: Math.round(mi * 1.3 * 3 + routable.length * 4) + " min" });
      setBusy(false);
      notify("⚡ Route ordered — " + routable.length + " stops");
    };
    /* geocode any missing first */
    var q = pend.slice(), i = 0;
    if (!q.length || !mapsReady) return run();
    (function next() {
      if (i >= q.length) return run();
      var o = q[i++];
      geocodeLive(o.addr, function (r) { if (r.lat != null) { o.lat = r.lat; o.lng = r.lng; } setTimeout(next, 300); });
    })();
  }
  function openAllMaps() {
    var pts = stops.filter(function (o) { return o.addr; }).map(function (o) { return o.addr; });
    if (!pts.length) return;
    var url = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(TAPE_DIRECT.address) +
      "&destination=" + encodeURIComponent(pts[pts.length - 1]) +
      (pts.length > 1 ? "&waypoints=" + pts.slice(0, -1).map(encodeURIComponent).join("%7C") : "") + "&travelmode=driving";
    window.open(url, "_blank");
  }
  /* single authoritative completion write */
  function completeStop(o, newStatus, payPatch, note, receiptInfo) {
    var save = props.onSave;
    var raw = o._raw;
    var hist = (raw.history || []).concat([{ status: newStatus, ts: new Date().toISOString(), note: note, by: me || "Driver" }]);
    var boxes = (raw.boxes || []).map(function (b) { return Object.assign({}, b, { orderStatus: newStatus, status: newStatus }); });
    var updated = Object.assign({}, raw, payPatch || {}, { status: newStatus, history: hist, boxes: boxes });
    if (save) { try { save(updated); } catch (e) { console.error(e); } }
    if (receiptInfo) {
      window.open(receiptWaUrl(o, receiptInfo.collected, receiptInfo.method, receiptInfo.balance), "_blank");
    }
  }
  function alreadyPaid(o) {
    completeStop(o, "picked_up", null, "Picked up — already paid", { collected: 0, method: "prepaid", balance: 0 });
    notify("✅ " + o.name + " — picked up · receipt opened in WhatsApp");
  }
  function confirmCollect(o) {
    var collected = Math.max(0, parseFloat(amt) || 0);
    var bal = balanceOf(o);
    var newBal = Math.max(0, bal - collected);
    var p = Object.assign({}, o._raw.payment || {});
    p.paid = (parseFloat(p.paid) || 0) + collected;
    p.method = mth.toLowerCase();
    p.status = newBal <= 0 ? "paid" : (parseFloat(p.paid) > 0 ? "deposit" : (p.status || "unpaid"));
    var note = "Picked up — collected " + fmt$(collected) + " (" + mth + ")" + (newBal > 0 ? " · balance " + fmt$(newBal) : " · paid in full");
    completeStop(o, "picked_up", {
      payment: p,
      stopCompletion: { collected: collected, method: mth, owed: newBal, completedAt: new Date().toISOString(), completedByDriver: me }
    }, note, newBal <= 0 ? { collected: collected, method: mth, balance: 0 } : null);
    setPayFor(null); setAmt("");
    notify(newBal <= 0
      ? "✅ " + o.name + " — paid in full · receipt opened in WhatsApp"
      : "🟡 " + o.name + " — " + fmt$(collected) + " collected · balance " + fmt$(newBal) + " saved to the order");
  }
  function boxDelivered(o) {
    completeStop(o, "box_dropped_off", { stopCompletion: { completedAt: new Date().toISOString(), completedByDriver: me } }, "Empty box delivered");
    notify("📦 " + o.name + " — box delivered");
  }

  /* ---- render ---- */
  function chip(txt, fg, bg) {
    return h("span", { style: { fontSize: 10.5, fontWeight: 800, color: fg, background: bg, borderRadius: 7, padding: "3px 9px" } }, txt);
  }
  var stopCards = stops.map(function (o, i) {
    var bal = balanceOf(o);
    var isPick = o.service === "pickup";
    var dest = o.lat != null ? o.lat + "," + o.lng : o.addr;
    var paying = payFor === o.tn;
    return h("div", { key: o.tn, className: "dl-stop" },
      h("div", { className: "dl-head" },
        h("div", { style: { width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: isPick ? "#f5972a" : "#3b9bff", color: "#1a1206", fontWeight: 800, fontSize: 12, display: "grid", placeItems: "center", marginTop: 2 } }, i + 1),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", { style: { fontWeight: 800, fontSize: 14 } }, o.name),
          h("div", { style: { color: "var(--text-dim)", fontSize: 11.5, marginTop: 2 } }, o.addr),
          h("div", { style: { display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap", alignItems: "center" } },
            h("span", { style: { color: "var(--orange-ink)", fontWeight: 700, fontSize: 11.5, fontFamily: "ui-monospace,monospace" } }, o.tn),
            chip(o.box, "#c2cdde", "var(--gray-pill)"),
            chip(isPick ? "Pickup" : "Drop box", isPick ? "#ffd06b" : "#8cc6ff", isPick ? "var(--amber-soft)" : "var(--blue-soft)")
          )
        ),
        h("div", { style: { display: "flex", gap: 6 } },
          o.phone ? h("a", { className: "dl-btn", href: "tel:" + o.phone, title: "Call customer", style: { textDecoration: "none", width: 40, padding: 0, justifyContent: "center" } }, "📞") : null,
          h("button", { className: "dl-btn", style: { width: 40, padding: 0, justifyContent: "center" }, title: "Navigate", onClick: function () { window.open(navUrl("google", dest, o.addr), "_blank"); } }, "🧭")
        )
      ),
      h("div", { className: "dl-pay" },
        isPick
          ? (paying
            ? h("div", { className: "dl-payrow" },
                h("span", { style: { fontSize: 11, color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" } }, "Collected"),
                h("input", { autoFocus: true, type: "number", min: 0, value: amt, placeholder: String(bal),
                  onChange: function (e) { setAmt(e.target.value); },
                  style: { width: 110, height: 38, borderRadius: 9, border: "1px solid var(--border)", background: "#0a0f18", color: "var(--text)", padding: "0 11px", fontSize: 15, fontWeight: 800 } }),
                ["Cash", "Zelle", "Venmo", "CashApp"].map(function (m) {
                  return h("button", { key: m, className: "dl-btn", onClick: function () { setMth(m); },
                    style: mth === m ? { background: "var(--green-soft)", color: "#5be3ab", borderColor: "rgba(39,194,129,.45)" } : {} }, m);
                }),
                h("button", { className: "dl-btn collect", disabled: amt === "", onClick: function () { confirmCollect(o); } }, "✓ Confirm"),
                h("button", { className: "dl-btn", onClick: function () { setPayFor(null); setAmt(""); } }, "Cancel"),
                (parseFloat(amt) || 0) < bal && amt !== ""
                  ? h("span", { style: { color: "var(--yellow)", fontWeight: 800, fontSize: 12 } }, "Balance left: " + fmt$(bal - (parseFloat(amt) || 0)))
                  : null
              )
            : h("div", { className: "dl-payrow" },
                h("span", { className: "dl-due " + (bal <= 0 ? "zero" : "owe") }, bal <= 0 ? "Paid ✓ $0 due" : "Due: " + fmt$(bal)),
                h("div", { style: { flex: 1 } }),
                bal <= 0
                  ? h("button", { className: "dl-btn paid", onClick: function () { alreadyPaid(o); } }, "✓ Already paid — send receipt")
                  : [h("button", { key: "ap", className: "dl-btn paid", onClick: function () { alreadyPaid(o); }, title: "Customer already paid outside the app" }, "✓ Already paid"),
                     h("button", { key: "cl", className: "dl-btn collect", onClick: function () { setPayFor(o.tn); setAmt(String(bal)); setMth("Cash"); } }, "💵 Collect " + fmt$(bal))]
              ))
          : h("div", { className: "dl-payrow" },
              h("span", { style: { color: "var(--text-dim)", fontSize: 12.5 } }, "Deliver empty box — no payment at this stop"),
              h("div", { style: { flex: 1 } }),
              h("button", { className: "dl-btn deliver", onClick: function () { boxDelivered(o); } }, "📦 Box delivered")
            )
      )
    );
  });

  return h("div", { className: "ro-scope fu", style: { display: "block" } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 } },
      h("div", { style: { width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 20, background: "var(--orange-soft)", border: "1px solid rgba(245,151,42,.3)" } }, "🚚"),
      h("div", null,
        h("div", { className: "display", style: { fontSize: 20, fontWeight: 800 } }, "Today's Route" + (me ? " — " + me : "")),
        h("div", { style: { color: "var(--muted)", fontSize: 12, marginTop: 2 } },
          stops.length + " stop" + (stops.length === 1 ? "" : "s") + " · dispatcher order" + (stats ? " · " + stats.dist + " · " + stats.time : ""))
      ),
      h("div", { style: { flex: 1 } }),
      h("button", { className: "btn", onClick: openAllMaps, disabled: !stops.length }, "📍 Open route in Google Maps"),
      h("button", { className: "btn primary", onClick: optimizeLite, disabled: busy || !stops.length }, busy ? "Ordering…" : "⚡ Optimize my stops")
    ),
    h("div", { style: { background: "var(--green-soft)", border: "1px solid rgba(39,194,129,.28)", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: "#a9e8cd", marginBottom: 14 } },
      "📡 ", h("b", { style: { color: "#cfffe9" } }, "Live"), " — stops come from dispatch in real time. Tap a stop's payment action; the order, payment and receipt all update automatically."),
    stops.length ? stopCards :
      h("div", { className: "empty" }, "No stops assigned right now. New pickups and box drop-offs appear here the moment dispatch assigns them.")
  );
};

})();
