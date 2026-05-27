# PHASE 4: QUICK REFERENCE CHEAT SHEET

**For:** Developers implementing HQ Unified Tabs  
**Time Saved:** Copy/paste snippets, no searching through 30KB docs  
**Date:** May 26, 2026  

---

## FILE LOCATIONS

| Document | Purpose | Size | Read Time |
|----------|---------|------|-----------|
| `PHASE4-HQ-UNIFIED-TABS-ARCHITECTURE.md` | Full design | 27 KB | 15 min |
| `PHASE4-IMPLEMENTATION-GUIDE.md` | Code snippets | 30 KB | 20 min |
| `PHASE4-SUPABASE-QUERIES.sql` | SQL queries | 11 KB | 5 min |
| `PHASE4-DELIVERABLES.md` | Summary | 14 KB | 5 min |
| **This file** | Cheat sheet | 2 KB | 2 min |

---

## COMPONENTS AT A GLANCE

```
HQUnifiedTabs
├─ TabNavigation (3 buttons)
├─ PickupTab (ASSIGNED status)
│  ├─ FilterBar
│  └─ OrderCard grid
├─ DropoffTab (PICKED_UP/IN_TRANSIT status)
│  ├─ FilterBar
│  └─ DropoffCard grid
└─ CompletedTab (DELIVERED/COMPLETED status)
   ├─ FilterBar
   └─ CompletedTable (pagination)
```

---

## STATE (FilterContext)

```javascript
{
  office_id: null,         // uuid | null
  driver_id: null,         // uuid | null
  status: null,            // string | null
  payment_status: null,    // 'paid' | 'pending' | 'failed'
  date_from: "2026-05-19", // ISO date
  date_to: "2026-05-26",   // ISO date
  search_text: "",         // string
  sort_by: "date_desc",    // 'date_asc', 'date_desc', 'driver', 'office'
  page: 0,                 // int
  page_size: 25            // int
}
```

---

## KEY QUERIES

### Get Pickup Orders
```javascript
SupabaseQueries.getPickupOrders(filters)
// Returns: { boxes: Array, count: number }
// Status: ASSIGNED
```

### Get Dropoff Orders
```javascript
SupabaseQueries.getDropoffOrders(filters)
// Returns: { boxes: Array, count: number }
// Status: PICKED_UP, IN_TRANSIT
```

### Get Completed Orders
```javascript
SupabaseQueries.getCompletedOrders(filters, page, pageSize)
// Returns: { orders: Array, total: number }
// Status: DELIVERED, COMPLETED
```

### Get Box Details
```javascript
SupabaseQueries.getOrderBoxDetails(orderId)
// Returns: Array of boxes for order
```

### Get Activity Trail
```javascript
SupabaseQueries.getOrderActivityTrail(orderId)
// Returns: Array of activities (last 50)
```

---

## FILTER ACTIONS

```javascript
// Inside FilterBar component
dispatch({ type: 'SET_OFFICE', payload: 'uuid' })
dispatch({ type: 'SET_DRIVER', payload: 'uuid' })
dispatch({ type: 'SET_STATUS', payload: 'assigned' })
dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'paid' })
dispatch({ type: 'SET_DATE_RANGE', payload: { from: '2026-05-01', to: '2026-05-31' } })
dispatch({ type: 'SET_SEARCH', payload: 'search text' })
dispatch({ type: 'SET_SORT', payload: 'date_desc' })
dispatch({ type: 'SET_PAGE', payload: 1 })
dispatch({ type: 'RESET' })  // Clear all filters
```

---

## REAL-TIME SUBSCRIPTIONS

```javascript
// On component mount
RealTimeService.subscribeBoxOrders((update) => {
  // update.type === 'box_order_change'
  // update.data === { id, order_id, status, ... }
  // Action: Refresh tab data
});

RealTimeService.subscribeActivityLog((update) => {
  // update.type === 'activity_log_change'
  // update.data === { id, activity_type, description, ... }
  // Action: Update UI, log to console
});

// On component unmount
return () => RealTimeService.unsubscribeAll();
```

---

## COMPONENT PROPS

### OrderCard
```javascript
<OrderCard 
  box={{id, order_id, status, barcode, weight_lbs, box_number}}
  order={{customer_name, recipient_name, pickup_location}}
  onAction={(orderId) => { /* reassign, etc */ }}
/>
```

### DropoffCard
```javascript
<DropoffCard
  box={{id, order_id, status, driver_id}}
  order={{customer_name, recipient_name, recipient_address, recipient_phone}}
/>
```

### FilterBar
```javascript
<FilterBar 
  offices={[{id, name, city}]}
  drivers={[{user_id, full_name, phone}]}
/>
```

---

## CSS CLASSES (Inline Styles)

```javascript
// Main container
styles.container

// Header section
styles.header

// Tab navigation
styles.tabNav
styles.tabButton
styles.tabButtonActive

// Filter bar
styles.filterBar
styles.select
styles.input

// Buttons
styles.buttonPrimary      // Black button
styles.buttonSecondary    // Gray button
styles.buttonSmall        // Tiny button

// Cards
styles.card
styles.cardHeader
styles.cardBody
styles.cardGrid           // Grid layout

// Table
styles.table
styles.pagination

// Badges
styles.badge              // Blue pill
```

---

## AUTHENTICATION CHECK

```javascript
const user = _supabase.auth.user();
const role = user?.user_metadata?.role || 'anonymous';

if (role !== 'hq') {
  return <div>Unauthorized: HQ access required</div>;
}
```

---

## ERROR HANDLING PATTERN

```javascript
try {
  const result = await SupabaseQueries.getPickupOrders(filters);
  if (result.error) {
    setError(result.error);
    console.error('Query failed:', result.error);
  } else {
    setOrders(result.boxes);
  }
} catch (e) {
  setError(e.message);
  console.error('Unexpected error:', e);
}
```

---

## COMMON PATTERNS

### useEffect + Loading State
```javascript
const [orders, setOrders] = React.useState([]);
const [loading, setLoading] = React.useState(true);

React.useEffect(() => {
  (async () => {
    setLoading(true);
    const result = await SupabaseQueries.getPickupOrders(filters);
    setOrders(result.boxes || []);
    setLoading(false);
  })();
}, [filters]);
```

### Filter with Default Date Range
```javascript
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const dateFrom = sevenDaysAgo.toISOString().split('T')[0];
const dateTo = new Date().toISOString().split('T')[0];
```

### Responsive Grid
```javascript
gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))'
// = 1 col on mobile, 2+ on desktop
```

### CSV Export
```javascript
const csv = [
  ['Order ID', 'Customer', ...],
  ...orders.map(o => [o.id, o.customer_name, ...])
].map(row => row.join(',')).join('\n');

const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'export.csv';
a.click();
```

---

## PERFORMANCE TIPS

- Limit queries to 100 rows (pickup, dropoff)
- Paginate completed tab (25-50 per page)
- Use `limit()` on Supabase queries
- Debounce filter changes (200ms)
- Cache office/driver lists (fetch once)
- Unsubscribe from realtime on unmount

---

## TESTING CHECKLIST

- [ ] HQ can see all orders (no filtering by role)
- [ ] Non-HQ denied access (403 Unauthorized)
- [ ] Filters apply correctly
- [ ] Real-time updates refresh UI
- [ ] CSV export downloads
- [ ] Table pagination works
- [ ] Search finds orders
- [ ] Load time <2s
- [ ] Mobile responsive
- [ ] All 147 smoke tests pass

---

## DEPENDENCY VERSIONS

```html
React 18.2.0
ReactDOM 18.2.0
Supabase JS v2
Stripe JS v3 (optional)
```

From CDN, no bundling needed.

---

## FILE STRUCTURE

```
~/casabe-v3/
├─ index.html (Phase 3, extend with Phase 4 code)
├─ PHASE4-HQ-UNIFIED-TABS-ARCHITECTURE.md (← Read first)
├─ PHASE4-IMPLEMENTATION-GUIDE.md (← Dev reference)
├─ PHASE4-SUPABASE-QUERIES.sql (← SQL reference)
├─ PHASE4-DELIVERABLES.md (← Summary)
└─ PHASE4-QUICK-REFERENCE.md (← You are here)
```

---

## QUICK START (15 MIN)

1. **Read:** PHASE4-IMPLEMENTATION-GUIDE.md (setup section)
2. **Copy:** SupabaseQueries service → index.html
3. **Copy:** RealTimeService → index.html
4. **Copy:** styles object → index.html
5. **Build:** HQUnifiedTabs component (scaffold)
6. **Test:** `npm test` (or manual browser test)

---

## COMMON MISTAKES TO AVOID

❌ Forget to unsubscribe from realtime (memory leak)  
❌ Use `limit()` without checking pagination  
❌ Filter by date as YYYY-MM-DD (need ISO datetime)  
❌ Forgot to add `auth.uid()` to activity_log INSERT  
❌ Update box_orders without creating activity_log entry  
❌ Render 1000 order cards (use pagination!)  
❌ Try to DELETE activity_log (immutable, RLS blocks it)  
❌ Non-HQ role accesses HQ tab (RLS will 403)  

---

## LINKS

| Ref | Link |
|-----|------|
| Phase 1 Schema | `PHASE1-IMPLEMENTATION.md` |
| Phase 3 Stripe | `PHASE3-FINAL-DELIVERY.md` |
| Supabase Docs | https://supabase.com/docs |
| React Docs | https://react.dev |

---

## SIGN-OFF

✅ Architecture complete  
✅ Queries written  
✅ Code scaffolding ready  
✅ Timeline estimated (4-6 hours)  
✅ Ready for development  

**Go build Phase 4!**

---

**Document:** PHASE4-QUICK-REFERENCE.md  
**Version:** 1.0  
**Date:** May 26, 2026 @ 21:03 EDT  
