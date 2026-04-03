/**
 * T2-003: Zone Spoofing Prevention — Zone Validation Middleware
 *
 * The vulnerability: clients can submit any zone_id and get lower pricing tiers.
 * The fix: server determines zone from destination (canonical lookup), generates
 * a signed token, and validates that token on every order submission.
 *
 * Flow:
 *  1. Client calls GET /api/zones/validate?destination=<dest>
 *  2. Server looks up zone from its own DEST_ZONE_MAP (cannot be spoofed)
 *  3. Server returns { zone, pricingTier, token } (token = HMAC-signed zone+ts)
 *  4. On order creation, client submits token; server verifies signature
 *     and rejects any zone that doesn't match the token
 */

'use strict';

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────
// Authoritative zone map  (mirrors GT_DEPARTMENTS in frontend,
// but SERVER is the source of truth — client cannot override)
// ─────────────────────────────────────────────────────────
const DEST_ZONE_MAP = {
  // Green — standard
  'Guatemala City': 'green',
  'Antigua':        'green',
  'Chimaltenango':  'green',
  'Sacatepéquez':   'green',
  'Santa Rosa':     'green',
  'Sololá':         'green',
  // Yellow — extended
  'Cobán':          'yellow',
  'Livingston':     'yellow',
  'Morales':        'yellow',
  'Puerto Barrios': 'yellow',
  'Santo Tomás':    'yellow',
  // Blue — regional
  'Huehuetenango':  'blue',
  'Quetzaltenango': 'blue',
  'Quiché':         'blue',
  'San Marcos':     'blue',
  'Totonicapán':    'blue',
  // Red — remote
  'Baja Verapaz':   'red',
  'Chiquimula':     'red',
  'Escuintla':      'red',
  'Jalapa':         'red',
  'Jutiapa':        'red',
  'Mazatenango':    'red',
  'Petén':          'red',
  'El Progreso':    'red',
  'Retalhuleu':     'red',
  'Salamá':         'red',
  'Zacapa':         'red',
  // Orange — far remote
  'Alta Verapaz':   'orange',
  'Suchitepéquez':  'orange',
};

// Zone → pricing tier mapping (server-controlled)
const ZONE_PRICING = {
  green:  { tier: 1, label: 'Standard',   surcharge: 0.00 },
  yellow: { tier: 2, label: 'Extended',   surcharge: 5.00 },
  blue:   { tier: 3, label: 'Regional',   surcharge: 10.00 },
  red:    { tier: 4, label: 'Remote',     surcharge: 20.00 },
  orange: { tier: 5, label: 'Far Remote', surcharge: 30.00 },
};

const TOKEN_TTL_MS  = 30 * 60 * 1000; // 30-minute window for token validity
const HMAC_ALGO     = 'sha256';

/**
 * Resolve destination string → zone (case-insensitive partial match)
 * @param {string} destination
 * @returns {string|null}
 */
function resolveZone(destination) {
  if (!destination) return null;

  // Exact match first
  if (DEST_ZONE_MAP[destination]) return DEST_ZONE_MAP[destination];

  // Case-insensitive partial match
  const lower = destination.toLowerCase().trim();
  for (const [key, zone] of Object.entries(DEST_ZONE_MAP)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return zone;
    }
  }
  return null;
}

/**
 * Generate a signed zone token
 * payload = `${zone}:${destination}:${issuedAt}`
 * signature = HMAC-SHA256(payload, JWT_SECRET)
 */
function generateZoneToken(zone, destination, secret) {
  const issuedAt = Date.now();
  const payload  = `${zone}:${destination}:${issuedAt}`;
  const sig      = crypto.createHmac(HMAC_ALGO, secret).update(payload).digest('hex');
  // Encode as base64url for compact transport
  const token = Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
  return { token, issuedAt };
}

/**
 * Verify a zone token
 * Returns { valid: bool, zone: string|null, reason: string }
 */
function verifyZoneToken(token, expectedZone, secret) {
  if (!token) return { valid: false, zone: null, reason: 'missing zone token' };

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, zone: null, reason: 'malformed zone token' };
  }

  const { payload, sig } = parsed;
  if (!payload || !sig) return { valid: false, zone: null, reason: 'invalid token structure' };

  // Re-compute signature
  const expectedSig = crypto.createHmac(HMAC_ALGO, secret).update(payload).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
    return { valid: false, zone: null, reason: 'zone token signature mismatch — possible spoofing attempt' };
  }

  // Parse payload parts
  const parts = payload.split(':');
  if (parts.length < 3) return { valid: false, zone: null, reason: 'malformed token payload' };

  const tokenZone = parts[0];
  const issuedAt  = parseInt(parts[parts.length - 1], 10);

  // Check TTL
  if (Date.now() - issuedAt > TOKEN_TTL_MS) {
    return { valid: false, zone: null, reason: 'zone token expired' };
  }

  // Check zone matches what server would compute (prevents zone substitution)
  if (expectedZone && tokenZone !== expectedZone) {
    return { valid: false, zone: tokenZone, reason: `zone mismatch: token says "${tokenZone}", server computed "${expectedZone}"` };
  }

  return { valid: true, zone: tokenZone, reason: 'ok' };
}

/**
 * Express middleware: validates zone token on order creation.
 * Expects req.body.zoneToken + req.body.destination
 * Sets req.validatedZone on success.
 */
function zoneValidationMiddleware(secret) {
  return function(req, res, next) {
    const { destination, zoneToken } = req.body || {};

    if (!destination) {
      return res.status(400).json({ error: 'destination is required' });
    }

    if (!zoneToken) {
      return res.status(400).json({ error: 'zoneToken is required — obtain from GET /api/zones/validate' });
    }

    // Server resolves zone (not from client input)
    const serverZone = resolveZone(destination);
    if (!serverZone) {
      return res.status(400).json({ error: `Unknown destination: "${destination}"` });
    }

    const result = verifyZoneToken(zoneToken, serverZone, secret);
    if (!result.valid) {
      console.warn(`[T2-003] Zone spoofing rejected: ${result.reason}`, {
        destination,
        serverZone,
        ip: req.ip
      });
      return res.status(403).json({ error: `Zone validation failed: ${result.reason}` });
    }

    // Attach validated zone to request (downstream cannot override this)
    req.validatedZone    = result.zone;
    req.validatedPricing = ZONE_PRICING[result.zone] || null;
    next();
  };
}

/**
 * Register zone API routes on Express app.
 */
function registerZoneRoutes(app, secret) {
  /**
   * GET /api/zones/validate?destination=<dest>
   * Server determines zone and returns signed token.
   * Client MUST use this token when submitting an order.
   */
  app.get('/api/zones/validate', (req, res) => {
    const { destination } = req.query;

    if (!destination) {
      return res.status(400).json({ error: 'destination query param required' });
    }

    const zone = resolveZone(destination);
    if (!zone) {
      return res.status(404).json({ error: `Unknown destination: "${destination}"` });
    }

    const pricing       = ZONE_PRICING[zone];
    const { token }     = generateZoneToken(zone, destination, secret);

    return res.json({
      destination,
      zone,
      pricing,
      zoneToken: token,
      expiresIn: TOKEN_TTL_MS / 1000 // seconds
    });
  });

  /**
   * GET /api/zones
   * List all known zones (public, for UI autocomplete)
   */
  app.get('/api/zones', (req, res) => {
    const destinations = Object.entries(DEST_ZONE_MAP).map(([dest, zone]) => ({
      destination: dest,
      zone,
      pricing: ZONE_PRICING[zone]
    }));
    return res.json({ destinations });
  });
}

module.exports = {
  resolveZone,
  generateZoneToken,
  verifyZoneToken,
  zoneValidationMiddleware,
  registerZoneRoutes,
  DEST_ZONE_MAP,
  ZONE_PRICING,
  TOKEN_TTL_MS,
};
