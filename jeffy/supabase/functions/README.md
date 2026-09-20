# Edge Functions

Every third-party API key Jeffy uses lives here and nowhere else. The app ships
only the Supabase URL and anon key.

## Deploying

```bash
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ai-tag-item
```

## Conventions

- **Never use the service role to answer a user request.** `clientForRequest()`
  builds a Supabase client that forwards the caller's JWT, so every query a
  function makes is still subject to RLS. A bug in a function cannot become a
  data leak. The service role is reserved for writes the user genuinely cannot
  make themselves, such as the product lookup cache, and is used explicitly.
- **Never trust `closet_id` from the body.** Call `requireClosetMember()`,
  which calls the same `is_closet_member()` the RLS policies use.
- **Validate the model's output before returning it.** `_shared/contracts.ts`
  holds the schemas; a reply that does not parse becomes a typed error the app
  renders as "fill it in yourself", never a half-populated form.
- **Errors are `{ error: { code, message } }`** with the codes in
  `contracts.ts`, so the client can map them to specific copy.

## Functions

| Function | Milestone | Purpose |
|---|---|---|
| `ai-tag-item` | 1 | Identify one photographed garment (feature 1a). |
| `ai-rack-split` | 4 | Detect and crop each item on a rack (feature 1b). |
| `ai-tag-ocr` | 4 | Read a price tag or care label (feature 7c). |
| `product-lookup` | 4 | UPC lookup, cache-first (feature 7b, 7g). |
| `ai-outfit` | 2 | Pick 3 outfits from a shortlist (feature 3). |
| `ai-store-find` | 4 | Does this work with what I own (feature 6). |
| `ai-inspo-breakdown` | 5 | Break a look into pieces (feature 8b). |
| `shopping-search` | 5 | Web-search buy options within budget (feature 8c). |
| `push-dispatch` | 3 | Fan out push notifications. |

Only `ai-tag-item` exists so far; the rest land with their milestones.
