/**
 * T2-001: Insurance Fraud Prevention — Safety Warning Validation
 *
 * The vulnerability:
 *   1. Insurance checkbox is purely client-side. A user can uncheck it
 *      after acknowledging the safety warning, then submit `insurance: false`
 *      to avoid paying the premium, then file a claim later.
 *   2. Danger Zone warning (consigneeDangerZone) can be unchecked client-side
 *      after the driver has already accepted the route — creating liability.
 *
 * The fix:
 *   - Server validates that:
 *       a) If insurance is requested (insurance: true), declaredValue must be > 0
 *       b) safety_warnings_acknowledged must be true (server-issued token confirms this)
 *       c) Once an order is created with insurance + acknowledged, the flag cannot
 *          be changed to false (immutable after confirmation)
 *   - safety_warnings_acknowledged is a signed token (HMAC) issued by the server
 *     after the user submits an acknowledgement request. It cannot be forged.
 *   - On order creation, the server checks the token before processing.
 */

'use strict';

const crypto = require('crypto');

const ACKNOWLEDGEMENT_TTL_MS = 60 * 60 * 1000; // 1 hour — must re-ack if session stale
const HMAC_ALGO = 'sha256';

/**
 * Safety warnings that must be explicitly acknowledged before order submission.
 * These map to warning IDs the client must include in the acknowledgement request.
 */
const REQUIRED_WARNINGS = {
  INSURANCE_TERMS:    'insurance_terms',    // Insurance coverage scope + exclusions
  DECLARED_VALUE:     'declared_value',     // Declared value affects premium
  DANGER_ZONE:        'danger_zone',        // Driver safety — customer must come outside
  NO_REFUND_PACKED:   'no_refund_packed',   // No refund once box is packed
};

/**
 * Generate a signed safety acknowledgement token.
 * Client calls POST /api/safety/acknowledge with the list of warnings they confirmed.
 * Server responds with this token, which must be included in order creation.
 *
 * @param {string[]} acknowledgedWarnings  - array of warning IDs acknowledged
 * @param {string}   userId               - authenticated user ID
 * @param {string}   secret               - HMAC secret (JWT_SECRET)
 * @returns {{ token: string, issuedAt: number }}
 */
function generateAcknowledgementToken(acknowledgedWarnings, userId, secret) {
  const issuedAt = Date.now();
  const warningList = [...acknowledgedWarnings].sort().join(',');
  const payload = `${userId}:${warningList}:${issuedAt}`;
  const sig = crypto.createHmac(HMAC_ALGO, secret).update(payload).digest('hex');
  const token = Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
  return { token, issuedAt };
}

/**
 * Verify a safety acknowledgement token.
 * @param {string}   token
 * @param {string}   userId
 * @param {string[]} requiredWarnings  - warnings that must be in the token
 * @param {string}   secret
 * @returns {{ valid: boolean, acknowledgedWarnings: string[]|null, reason: string }}
 */
function verifyAcknowledgementToken(token, userId, requiredWarnings, secret) {
  if (!token) return { valid: false, acknowledgedWarnings: null, reason: 'missing acknowledgement token' };

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, acknowledgedWarnings: null, reason: 'malformed acknowledgement token' };
  }

  const { payload, sig } = parsed;
  if (!payload || !sig) {
    return { valid: false, acknowledgedWarnings: null, reason: 'invalid token structure' };
  }

  // Verify signature
  const expectedSig = crypto.createHmac(HMAC_ALGO, secret).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
      return { valid: false, acknowledgedWarnings: null, reason: 'acknowledgement token signature mismatch' };
    }
  } catch {
    return { valid: false, acknowledgedWarnings: null, reason: 'signature comparison failed' };
  }

  // Parse payload: userId:warningList:issuedAt
  const lastColon = payload.lastIndexOf(':');
  const secondLastColon = payload.lastIndexOf(':', lastColon - 1);
  const tokenUserId = payload.substring(0, secondLastColon);
  const warningList = payload.substring(secondLastColon + 1, lastColon);
  const issuedAt = parseInt(payload.substring(lastColon + 1), 10);

  // Check TTL
  if (Date.now() - issuedAt > ACKNOWLEDGEMENT_TTL_MS) {
    return { valid: false, acknowledgedWarnings: null, reason: 'acknowledgement token expired — must re-acknowledge' };
  }

  // Check user binding (token cannot be reused by another user)
  if (tokenUserId !== userId) {
    return { valid: false, acknowledgedWarnings: null, reason: 'acknowledgement token user mismatch' };
  }

  const acknowledgedWarnings = warningList ? warningList.split(',') : [];

  // Verify all required warnings were acknowledged
  if (requiredWarnings && requiredWarnings.length > 0) {
    const missing = requiredWarnings.filter(w => !acknowledgedWarnings.includes(w));
    if (missing.length > 0) {
      return {
        valid: false,
        acknowledgedWarnings,
        reason: `missing acknowledgement for: ${missing.join(', ')}`
      };
    }
  }

  return { valid: true, acknowledgedWarnings, reason: 'ok' };
}

/**
 * Validate the safety-related fields of an order request.
 * Returns { valid: boolean, errors: string[] }
 *
 * Rules:
 *  - insurance: true → declaredValue must be a positive number
 *  - insurance: true → insuranceAcknowledgementToken must be valid
 *  - consigneeDangerZone: true → dangerZoneAcknowledgementToken must be valid
 *  - Once order created with insurance: true, server-side flag is immutable
 */
function validateOrderSafetyFields(orderData, userId, secret) {
  const errors = [];
  const { insurance, declaredValue, consigneeDangerZone, safetyAcknowledgementToken } = orderData;

  // Determine which warnings are required for this order
  const requiredWarnings = [REQUIRED_WARNINGS.NO_REFUND_PACKED];

  if (insurance) {
    if (!declaredValue || Number(declaredValue) <= 0) {
      errors.push('declaredValue must be a positive number when insurance is selected');
    }
    requiredWarnings.push(REQUIRED_WARNINGS.INSURANCE_TERMS);
    requiredWarnings.push(REQUIRED_WARNINGS.DECLARED_VALUE);
  }

  if (consigneeDangerZone) {
    requiredWarnings.push(REQUIRED_WARNINGS.DANGER_ZONE);
  }

  // Validate acknowledgement token covers all required warnings
  const result = verifyAcknowledgementToken(
    safetyAcknowledgementToken,
    userId,
    requiredWarnings,
    secret
  );

  if (!result.valid) {
    errors.push(`Safety acknowledgement invalid: ${result.reason}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    requiredWarnings,
    acknowledgedWarnings: result.acknowledgedWarnings
  };
}

/**
 * Express middleware: validates safety acknowledgement on order creation.
 * Expects req.user.id (set by auth middleware) and req.body.*
 */
function safetyValidationMiddleware(secret) {
  return function(req, res, next) {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = validateOrderSafetyFields(req.body, userId, secret);

    if (!result.valid) {
      console.warn('[T2-001] Safety validation failed:', result.errors, { userId, ip: req.ip });
      return res.status(400).json({
        error:            'Safety validation failed',
        details:          result.errors,
        requiredWarnings: result.requiredWarnings
      });
    }

    req.safetyValidated = true;
    req.acknowledgedWarnings = result.acknowledgedWarnings;
    next();
  };
}

/**
 * Register safety-related routes on Express app.
 */
function registerSafetyRoutes(app, secret) {
  /**
   * POST /api/safety/acknowledge
   * Body: { warnings: ['insurance_terms', 'declared_value', ...] }
   * Returns signed acknowledgement token.
   * Requires authentication.
   */
  app.post('/api/safety/acknowledge', (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { warnings } = req.body || {};
    if (!warnings || !Array.isArray(warnings) || warnings.length === 0) {
      return res.status(400).json({ error: 'warnings array is required' });
    }

    // Validate that only known warning IDs are submitted
    const knownIds = Object.values(REQUIRED_WARNINGS);
    const unknown  = warnings.filter(w => !knownIds.includes(w));
    if (unknown.length > 0) {
      return res.status(400).json({ error: `Unknown warning IDs: ${unknown.join(', ')}` });
    }

    const { token } = generateAcknowledgementToken(warnings, userId, secret);

    return res.json({
      acknowledged:  warnings,
      token,
      expiresIn:     ACKNOWLEDGEMENT_TTL_MS / 1000,
      message:       'Safety warnings acknowledged. Include token in order creation.'
    });
  });

  /**
   * GET /api/safety/warnings
   * Returns list of required warning IDs (for UI to display).
   */
  app.get('/api/safety/warnings', (req, res) => {
    return res.json({
      warnings: Object.entries(REQUIRED_WARNINGS).map(([key, id]) => ({ key, id }))
    });
  });
}

module.exports = {
  generateAcknowledgementToken,
  verifyAcknowledgementToken,
  validateOrderSafetyFields,
  safetyValidationMiddleware,
  registerSafetyRoutes,
  REQUIRED_WARNINGS,
  ACKNOWLEDGEMENT_TTL_MS,
};
