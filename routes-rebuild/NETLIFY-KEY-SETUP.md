# Netlify Browser Key Setup

## Steps (one-time, before first deploy with Google Maps)

1. Go to Netlify Dashboard → Site settings → Environment variables
2. Add: `GOOGLE_MAPS_API_KEY` = your Maps JS + Places restricted browser key
3. In `index.html`, use the placeholder:
   `const GOOGLE_MAPS_API_KEY = '%%GOOGLE_MAPS_KEY%%';`
4. `netlify.toml` handles substitution at build time
5. The deployed build will have the real key — never commit the real key to git

## Key restrictions (required in Google Cloud Console)
- Application restrictions: HTTP referrers
- Allowed referrers: `casabekonnect-app.netlify.app/*` + any approved preview domains
- API restrictions: Maps JavaScript API, Places API ONLY

## Server keys
Server-side keys (Geocoding + Routes) go in Supabase Edge Function secrets, NOT here.
