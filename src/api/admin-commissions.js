/**
 * T2-004: Commission Audit Trail — Admin API
 *
 * Provides admin-only endpoints for:
 * - Retrieving commission audit logs
 * - Viewing commission history per order
 *
 * Security: requires admin JWT role
 */

'use strict';

/**
 * Register commission audit routes on an Express app.
 * @param {import('express').Application} app
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Function} authenticateToken  - JWT auth middleware
 * @param {Function} requireAdmin       - Admin role guard middleware
 */
function registerCommissionRoutes(app, supabase, authenticateToken, requireAdmin) {

  /**
   * GET /api/admin/commissions/audit
   * Query params:
   *   order_id  (optional) — filter by order
   *   limit     (optional, default 50, max 500)
   *   offset    (optional, default 0)
   */
  app.get('/api/admin/commissions/audit', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { order_id, limit = 50, offset = 0 } = req.query;

      const parsedLimit = Math.min(parseInt(limit, 10) || 50, 500);
      const parsedOffset = parseInt(offset, 10) || 0;

      // Base query: join commission_audit_log with commissions
      let query = supabase
        .from('commission_audit_log')
        .select(`
          id,
          commission_id,
          operation,
          old_data,
          new_data,
          changed_by,
          changed_at,
          commissions!commission_audit_log_commission_id_fkey (
            order_id,
            amount,
            rate,
            calculation_method
          )
        `)
        .order('changed_at', { ascending: false })
        .range(parsedOffset, parsedOffset + parsedLimit - 1);

      // Filter by order_id if provided
      if (order_id) {
        // Filter via the commissions join
        query = query.eq('commissions.order_id', order_id);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('Commission audit query error:', error);
        return res.status(500).json({ error: 'Failed to retrieve audit log' });
      }

      return res.json({
        data: data || [],
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          count: (data || []).length
        }
      });

    } catch (err) {
      console.error('Commission audit endpoint error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/admin/commissions
   * List all commission records (admin only)
   */
  app.get('/api/admin/commissions', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { order_id, limit = 50, offset = 0 } = req.query;

      const parsedLimit = Math.min(parseInt(limit, 10) || 50, 500);
      const parsedOffset = parseInt(offset, 10) || 0;

      let query = supabase
        .from('commissions')
        .select('*')
        .order('created_at', { ascending: false })
        .range(parsedOffset, parsedOffset + parsedLimit - 1);

      if (order_id) {
        query = query.eq('order_id', order_id);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({ error: 'Failed to retrieve commissions' });
      }

      return res.json({
        data: data || [],
        pagination: { limit: parsedLimit, offset: parsedOffset, count: (data || []).length }
      });

    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = { registerCommissionRoutes };
