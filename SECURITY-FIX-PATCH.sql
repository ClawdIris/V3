-- ════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER VULNERABILITY FIX
-- Project: exayifxbqduhsxmmsnxr
-- Date: 2026-05-27
-- ════════════════════════════════════════════════════════════════════
-- This patch fixes search_path injection vulnerabilities in two SECURITY DEFINER
-- functions by adding SET search_path = '' and schema-qualifying table references.

-- FUNCTION 1: get_user_office_ids()
-- Previous vulnerability: unqualified 'members' table reference + missing search_path
-- Fixed: Added SET search_path = '' and qualified to public.members
CREATE OR REPLACE FUNCTION get_user_office_ids()
RETURNS UUID[] 
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
BEGIN
  RETURN ARRAY(
    SELECT office_id FROM public.members
    WHERE user_id = auth.uid()
      AND active = true
      AND tenant_id = current_tenant_id()
      AND office_id IS NOT NULL
  );
END;
$$;

-- FUNCTION 2: get_user_role()
-- Previous vulnerability: unqualified 'members' table reference + missing search_path
-- Fixed: Added SET search_path = '' and qualified to public.members
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT COALESCE(app_role, role) INTO user_role
  FROM public.members
  WHERE user_id = auth.uid()
    AND active = true
  ORDER BY created_at
  LIMIT 1;
  RETURN COALESCE(user_role, 'anonymous');
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- DEPLOYMENT INSTRUCTIONS
-- ════════════════════════════════════════════════════════════════════
-- 1. Log into Supabase console: https://app.supabase.com
-- 2. Select project: exayifxbqduhsxmmsnxr
-- 3. Navigate to SQL Editor
-- 4. Create a new query and paste the function definitions above
-- 5. Execute the query
-- 6. Verify in Security Advisor that no SECURITY DEFINER warnings remain
-- 7. All done!
