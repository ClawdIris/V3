# DOMAIN-FIX.md — casabekonnect.app Netlify Conflict Resolution

**Generated:** 2026-06-01  
**Issue:** `casabekonnect.app` domain is attached to a conflicting Netlify project, causing deploy/routing issues.

---

## Confirmed Target Site

| Field | Value |
|-------|-------|
| Netlify Site ID | `49b9a95d-59a3-463f-9d49-48795b8ac6ee` |
| State file | `~/casabe-v3/.netlify/state.json` ✅ confirmed |

---

## Issue

`casabekonnect.app` appears attached to a **second Netlify project** in the team. 
Netlify only allows one site per custom domain — the conflicting attachment prevents the correct site (`49b9a95d-59a3-463f-9d49-48795b8ac6ee`) from serving the domain.

**Note:** No `NETLIFY_AUTH_TOKEN` was found in environment or `.env*` files. 
API verification could not be automated. Follow the manual dashboard steps below.

---

## Step 1 — Find the Conflicting Site

1. Log into **Netlify Dashboard** → [app.netlify.com](https://app.netlify.com)
2. Navigate to **Team** → **Sites**
3. Use the search bar to find sites that contain `casabekonnect` in the name or domain
4. Open each site that is **NOT** `49b9a95d-59a3-463f-9d49-48795b8ac6ee`
5. Go to **Site Settings → Domain Management** for each suspect site
6. Look for `casabekonnect.app` under **Custom Domains**

---

## Step 2 — Remove Domain from Conflicting Site

Once you find the conflicting site:

1. Click **Site Settings → Domain Management**
2. Under **Custom Domains**, find `casabekonnect.app`
3. Click the **⋯ options** button next to it → **Remove domain**
4. Confirm removal
5. Wait 1–2 minutes for propagation

---

## Step 3 — Add Domain to Correct Site

1. Go to the correct site: Site ID `49b9a95d-59a3-463f-9d49-48795b8ac6ee`
   - Direct URL: `https://app.netlify.com/sites/[site-name]/settings/domain`
   - Or search by Site ID in Team → Sites
2. Click **Site Settings → Domain Management → Add custom domain**
3. Enter: `casabekonnect.app`
4. Netlify will verify DNS and show instructions

---

## Step 4 — DNS Records at GoDaddy

> **Do this AFTER** the Netlify conflict is resolved (Steps 1–3), otherwise DNS won't resolve correctly.

Log into GoDaddy DNS management for `casabekonnect.app` and set:

### Option A: Apex domain + www (Recommended)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| `A` | `@` | `75.2.60.5` | 600 |
| `CNAME` | `www` | `[your-netlify-site].netlify.app` | 600 |

> The `A` record IP (`75.2.60.5`) is Netlify's load balancer IP for apex domains.
> Get the exact value from **Netlify Dashboard → Domain Management → DNS settings** after adding the domain.

### Option B: If GoDaddy supports ALIAS/ANAME at apex

| Type | Name | Value | TTL |
|------|------|-------|-----|
| `ALIAS` or `ANAME` | `@` | `[your-netlify-site].netlify.app` | 600 |
| `CNAME` | `www` | `[your-netlify-site].netlify.app` | 600 |

---

## Step 5 — Enable HTTPS (Netlify Managed TLS)

After DNS propagates (5–60 min):

1. **Site Settings → Domain Management → HTTPS**
2. Click **Verify DNS Configuration**
3. Click **Provision Certificate** (Let's Encrypt, auto-renewed)
4. Test: `curl -I https://casabekonnect.app`

---

## If Netlify API Token Becomes Available

Run this to verify domain assignment programmatically:

```bash
# List domains on correct site
curl -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites/49b9a95d-59a3-463f-9d49-48795b8ac6ee" \
  | jq '.custom_domain, .domain_aliases'

# List ALL sites to find conflict
curl -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites?per_page=100" \
  | jq '.[] | {id: .id, name: .name, domain: .custom_domain}'
```

Token can be generated at: **User Settings → Applications → Personal access tokens**

---

## Summary Checklist

- [ ] Found conflicting Netlify site with `casabekonnect.app` attached
- [ ] Removed `casabekonnect.app` from conflicting site
- [ ] Added `casabekonnect.app` to site `49b9a95d-59a3-463f-9d49-48795b8ac6ee`
- [ ] Updated GoDaddy DNS (A + CNAME records)
- [ ] Waited for DNS propagation (TTL 600s = 10 min minimum)
- [ ] Verified HTTPS certificate provisioned
- [ ] Tested `https://casabekonnect.app` loads correctly
