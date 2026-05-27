# PHASE 4: HQ UNIFIED TABS — IMPLEMENTATION GUIDE

**Document:** PHASE4-IMPLEMENTATION-GUIDE.md  
**Date:** May 26, 2026 @ 21:03 EDT  
**Status:** 🔨 **CODING REFERENCE**  

This guide provides line-by-line component scaffolding, state management patterns, and copy-paste-ready code blocks for Phase 4 implementation.

---

## SETUP & BOILERPLATE

### 1. HTML Head (Update from Phase 3)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"/>
  <title>Casabe Konnect — HQ Operations</title>
  <!-- React 18 -->
  <script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
  <!-- Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
  <!-- Supabase JS -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <!-- Stripe JS (optional for payment status) -->
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/javascript">
"use strict";
// HQ UNIFIED TABS — PHASE 4
(function() {
  // ... implementation below
})());
  </script>
</body>
</html>
```

---

## STATE MANAGEMENT

### 2. Filter Context & Reducer

```javascript
// Initial filter state
const INITIAL_FILTER_STATE = {
  office_id: null,
  driver_id: null,
  status: null,
  payment_status: null,
  date_from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  date_to: new Date().toISOString().split('T')[0],
  search_text: '',
  sort_by: 'date_desc',
  page: 0,
  page_size: 25
};

// Filter reducer (for useReducer)
function filterReducer(state, action) {
  switch (action.type) {
    case 'SET_OFFICE':
      return { ...state, office_id: action.payload, page: 0 };
    case 'SET_DRIVER':
      return { ...state, driver_id: action.payload, page: 0 };
    case 'SET_STATUS':
      return { ...state, status: action.payload, page: 0 };
    case 'SET_PAYMENT_STATUS':
      return { ...state, payment_status: action.payload, page: 0 };
    case 'SET_DATE_RANGE':
      return { 
        ...state, 
        date_from: action.payload.from, 
        date_to: action.payload.to, 
        page: 0 
      };
    case 'SET_SEARCH':
      return { ...state, search_text: action.payload, page: 0 };
    case 'SET_SORT':
      return { ...state, sort_by: action.payload, page: 0 };
    case 'SET_PAGE':
      return { ...state, page: action.payload };
    case 'RESET':
      return INITIAL_FILTER_STATE;
    default:
      return state;
  }
}

// Create context
const FilterContext = React.createContext({
  filters: INITIAL_FILTER_STATE,
  dispatch: () => {}
});
```

---

## SERVICES & UTILITIES

### 3. SupabaseQueries Service

```javascript
const SupabaseQueries = {
  
  // Helper: Build WHERE clause from filters
  _buildBaseQuery(baseQuery, filters, statusArr) {
    let query = baseQuery.in('status', statusArr);
    
    if (filters.office_id) {
      query = query.eq('office_id', filters.office_id);
    }
    if (filters.driver_id) {
      query = query.eq('driver_id', filters.driver_id);
    }
    if (filters.date_from) {
      query = query.gte('created_at', filters.date_from + 'T00:00:00Z');
    }
    if (filters.date_to) {
      query = query.lte('created_at', filters.date_to + 'T23:59:59Z');
    }
    
    return query;
  },

  // PICKUP TAB
  async getPickupOrders(filters) {
    try {
      let query = _supabase
        .from('box_orders')
        .select(`
          id, order_id, box_number, status, driver_id, office_id, barcode,
          created_at, updated_at, weight_lbs,
          orders(id, customer_name, recipient_name, pickup_location)
        `, { count: 'exact' });
      
      query = this._buildBaseQuery(query, filters, ['assigned']);
      
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw new Error('Pickup query failed: ' + error.message);
      return { boxes: data || [], count: count || 0 };
    } catch (e) {
      console.error('getPickupOrders:', e);
      return { boxes: [], count: 0, error: e.message };
    }
  },

  // DROPOFF TAB
  async getDropoffOrders(filters) {
    try {
      let query = _supabase
        .from('box_orders')
        .select(`
          id, order_id, box_number, status, driver_id, office_id,
          created_at, status_updated_at,
          orders(id, customer_name, recipient_name, recipient_address, recipient_phone)
        `, { count: 'exact' });
      
      query = this._buildBaseQuery(query, filters, ['picked_up', 'in_transit']);
      
      const { data, error, count } = await query
        .order('status_updated_at', { ascending: false })
        .limit(100);
      
      if (error) throw new Error('Dropoff query failed: ' + error.message);
      return { boxes: data || [], count: count || 0 };
    } catch (e) {
      console.error('getDropoffOrders:', e);
      return { boxes: [], count: 0, error: e.message };
    }
  },

  // COMPLETED TAB
  async getCompletedOrders(filters, page = 0, pageSize = 25) {
    try {
      let query = _supabase
        .from('box_orders')
        .select(`
          order_id,
          orders(
            id, customer_name, recipient_name, recipient_address, 
            payment_status, created_at, updated_at
          )
        `, { count: 'exact' });
      
      query = this._buildBaseQuery(query, filters, ['delivered', 'completed']);
      
      if (filters.payment_status) {
        // Filter orders by payment_status
        query = query.filter('orders.payment_status', 'eq', filters.payment_status);
      }
      
      const { data, error, count } = await query
        .order('orders.updated_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error) throw new Error('Completed query failed: ' + error.message);
      
      // Deduplicate by order_id
      const orders = Array.from(
        new Map((data || []).map(item => [item.order_id, item])).values()
      );
      
      return { orders, total: count || 0 };
    } catch (e) {
      console.error('getCompletedOrders:', e);
      return { orders: [], total: 0, error: e.message };
    }
  },

  // BOX DETAILS FOR ORDER
  async getOrderBoxDetails(orderId) {
    try {
      const { data, error } = await _supabase
        .from('box_orders')
        .select(`
          id, box_number, status, barcode, weight_lbs, dimensions,
          delivered_at, delivery_notes, signature_url, created_at
        `)
        .eq('order_id', orderId)
        .order('box_number', { ascending: true });
      
      if (error) throw new Error('Box details failed: ' + error.message);
      return data || [];
    } catch (e) {
      console.error('getOrderBoxDetails:', e);
      return [];
    }
  },

  // ACTIVITY TRAIL FOR ORDER
  async getOrderActivityTrail(orderId) {
    try {
      const { data, error } = await _supabase
        .from('activity_log')
        .select(`
          id, activity_type, action, description, created_at
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw new Error('Activity trail failed: ' + error.message);
      return data || [];
    } catch (e) {
      console.error('getOrderActivityTrail:', e);
      return [];
    }
  },

  // OFFICES (FOR FILTER)
  async getOffices() {
    try {
      const { data, error } = await _supabase
        .from('offices')
        .select('id, name, city')
        .order('name');
      
      if (error) throw new Error('Offices query failed: ' + error.message);
      return data || [];
    } catch (e) {
      console.error('getOffices:', e);
      return [];
    }
  },

  // DRIVERS (FOR FILTER)
  async getDrivers(officeId = null) {
    try {
      let query = _supabase
        .from('user_profiles')
        .select('user_id, full_name, phone')
        .eq('role', 'driver');
      
      if (officeId) query = query.eq('office_id', officeId);
      
      const { data, error } = await query.order('full_name');
      if (error) throw new Error('Drivers query failed: ' + error.message);
      return data || [];
    } catch (e) {
      console.error('getDrivers:', e);
      return [];
    }
  },

  // UPDATE BOX STATUS (when HQ reassigns, etc.)
  async updateBoxStatus(boxId, newStatus) {
    try {
      const { data, error } = await _supabase
        .from('box_orders')
        .update({ status: newStatus, status_updated_at: new Date().toISOString() })
        .eq('id', boxId);
      
      if (error) throw new Error('Update failed: ' + error.message);
      return { success: true, data };
    } catch (e) {
      console.error('updateBoxStatus:', e);
      return { success: false, error: e.message };
    }
  }
};
```

### 4. RealTimeService

```javascript
const RealTimeService = {
  subscriptions: [],

  subscribeBoxOrders(onUpdate) {
    const sub = _supabase
      .from('box_orders')
      .on('*', (payload) => {
        onUpdate({ type: 'box_order_change', data: payload.new });
      })
      .subscribe();
    
    this.subscriptions.push(sub);
    return sub;
  },

  subscribeActivityLog(onUpdate) {
    const sub = _supabase
      .from('activity_log')
      .on('INSERT', (payload) => {
        // Only care about status changes
        if (['status_changed', 'box_assigned'].includes(payload.new.activity_type)) {
          onUpdate({ type: 'activity_log_change', data: payload.new });
        }
      })
      .subscribe();
    
    this.subscriptions.push(sub);
    return sub;
  },

  unsubscribeAll() {
    this.subscriptions.forEach(sub => {
      _supabase.removeSubscription(sub);
    });
    this.subscriptions = [];
  }
};
```

---

## COMPONENT HIERARCHY

### 5. Main App Component (HQUnifiedTabs)

```javascript
function HQUnifiedTabs() {
  const [user, setUser] = React.useState(null);
  const [activeTab, setActiveTab] = React.useState('pickup');
  const [filters, dispatchFilters] = React.useReducer(filterReducer, INITIAL_FILTER_STATE);
  const [offices, setOffices] = React.useState([]);
  const [drivers, setDrivers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  // Check auth on mount
  React.useEffect(() => {
    const session = _supabase.auth.session();
    const currentUser = session?.user;
    
    if (!currentUser) {
      setError('Not authenticated');
      return;
    }

    // Verify HQ role
    const role = currentUser.user_metadata?.role || 'unknown';
    if (role !== 'hq') {
      setError('Unauthorized: HQ access required');
      return;
    }

    setUser(currentUser);
  }, []);

  // Load filter options (offices, drivers)
  React.useEffect(() => {
    (async () => {
      const off = await SupabaseQueries.getOffices();
      const drv = await SupabaseQueries.getDrivers();
      setOffices(off);
      setDrivers(drv);
      setLoading(false);
    })();
  }, []);

  // Subscribe to real-time updates
  React.useEffect(() => {
    RealTimeService.subscribeBoxOrders((update) => {
      // Refresh current tab's data
      console.log('Box order update:', update);
    });

    RealTimeService.subscribeActivityLog((update) => {
      console.log('Activity log update:', update);
    });

    return () => RealTimeService.unsubscribeAll();
  }, []);

  if (!user) {
    return React.createElement('div', { style: { padding: '20px' } },
      React.createElement('h2', null, 'Authentication Required'),
      React.createElement('p', null, error || 'Please log in.')
    );
  }

  return React.createElement(FilterContext.Provider, { value: { filters, dispatch: dispatchFilters } },
    React.createElement('div', { style: styles.container },
      // Header
      React.createElement('header', { style: styles.header },
        React.createElement('h1', null, 'HQ Operations Dashboard'),
        React.createElement('p', null, 'Welcome, ' + user.email)
      ),

      // Tab Navigation
      React.createElement(TabNavigation, {
        activeTab: activeTab,
        onTabChange: setActiveTab
      }),

      // Tab Content
      React.createElement('div', { style: styles.content },
        activeTab === 'pickup' && React.createElement(PickupTab, { offices, drivers }),
        activeTab === 'dropoff' && React.createElement(DropoffTab, { offices, drivers }),
        activeTab === 'completed' && React.createElement(CompletedTab, { offices, drivers })
      )
    )
  );
}
```

### 6. TabNavigation Component

```javascript
function TabNavigation({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'pickup', label: '📦 Pickup Orders', icon: '📦' },
    { id: 'dropoff', label: '🚗 In Transit', icon: '🚗' },
    { id: 'completed', label: '✅ Completed', icon: '✅' }
  ];

  return React.createElement('nav', { style: styles.tabNav },
    React.createElement('div', { style: styles.tabList },
      tabs.map(tab =>
        React.createElement('button', {
          key: tab.id,
          onClick: () => onTabChange(tab.id),
          style: {
            ...styles.tabButton,
            ...(activeTab === tab.id ? styles.tabButtonActive : {})
          }
        }, tab.label)
      )
    )
  );
}
```

### 7. FilterBar Component (Shared)

```javascript
function FilterBar({ offices, drivers }) {
  const { filters, dispatch } = React.useContext(FilterContext);

  return React.createElement('div', { style: styles.filterBar },
    // Office filter
    React.createElement('select', {
      value: filters.office_id || '',
      onChange: (e) => dispatch({ type: 'SET_OFFICE', payload: e.target.value || null }),
      style: styles.select
    },
      React.createElement('option', { value: '' }, 'All Offices'),
      offices.map(o => 
        React.createElement('option', { key: o.id, value: o.id }, o.name)
      )
    ),

    // Driver filter
    React.createElement('select', {
      value: filters.driver_id || '',
      onChange: (e) => dispatch({ type: 'SET_DRIVER', payload: e.target.value || null }),
      style: styles.select
    },
      React.createElement('option', { value: '' }, 'All Drivers'),
      drivers.map(d =>
        React.createElement('option', { key: d.user_id, value: d.user_id }, d.full_name)
      )
    ),

    // Date range
    React.createElement('input', {
      type: 'date',
      value: filters.date_from,
      onChange: (e) => dispatch({ 
        type: 'SET_DATE_RANGE', 
        payload: { from: e.target.value, to: filters.date_to }
      }),
      style: styles.input
    }),

    React.createElement('span', { style: { margin: '0 5px' } }, '→'),

    React.createElement('input', {
      type: 'date',
      value: filters.date_to,
      onChange: (e) => dispatch({
        type: 'SET_DATE_RANGE',
        payload: { from: filters.date_from, to: e.target.value }
      }),
      style: styles.input
    }),

    // Reset button
    React.createElement('button', {
      onClick: () => dispatch({ type: 'RESET' }),
      style: styles.buttonSecondary
    }, 'Reset')
  );
}
```

### 8. PickupTab Component

```javascript
function PickupTab({ offices, drivers }) {
  const { filters } = React.useContext(FilterContext);
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

  return React.createElement('div', { style: styles.tabContent },
    React.createElement(FilterBar, { offices, drivers }),

    loading && React.createElement('p', { style: { padding: '20px' } }, 'Loading...'),

    !loading && orders.length === 0 && 
    React.createElement('p', { style: { padding: '20px', textAlign: 'center' } }, 
      'No orders ready for pickup.'),

    !loading && orders.length > 0 &&
    React.createElement('div', { style: styles.cardGrid },
      orders.map(box =>
        React.createElement(OrderCard, {
          key: box.id,
          box: box,
          order: box.orders,
          onAction: () => console.log('Order action on', box.order_id)
        })
      )
    )
  );
}
```

### 9. OrderCard Component

```javascript
function OrderCard({ box, order, onAction }) {
  const [expanded, setExpanded] = React.useState(false);
  const [details, setDetails] = React.useState(null);

  const loadDetails = async () => {
    if (!expanded && !details) {
      const boxDetails = await SupabaseQueries.getOrderBoxDetails(box.order_id);
      const activity = await SupabaseQueries.getOrderActivityTrail(box.order_id);
      setDetails({ boxes: boxDetails, activities: activity });
    }
    setExpanded(!expanded);
  };

  return React.createElement('div', { style: styles.card },
    // Card header
    React.createElement('div', {
      style: { ...styles.cardHeader, cursor: 'pointer' },
      onClick: loadDetails
    },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('h3', null, 'Order #' + box.order_id.substring(0, 8)),
        React.createElement('p', null, order?.customer_name || 'Unknown'),
        React.createElement('p', { style: { fontSize: '0.85em', color: '#666' } },
          'Pickup: ' + (order?.pickup_location || 'office'))
      ),
      React.createElement('span', { style: styles.badge }, box.status.toUpperCase())
    ),

    // Card body
    React.createElement('div', { style: styles.cardBody },
      React.createElement('p', null, 'Boxes: ' + box.box_number),
      React.createElement('p', null, 'Weight: ' + (box.weight_lbs || 'N/A') + ' lbs'),
      React.createElement('p', null, 'Barcode: ' + (box.barcode || 'N/A'))
    ),

    // Expanded details
    expanded && details && React.createElement('div', { style: styles.expandedDetails },
      React.createElement('h4', null, 'Box Details'),
      React.createElement('ul', null,
        (details.boxes || []).map(b =>
          React.createElement('li', { key: b.id },
            'Box ' + b.box_number + ': ' + b.status + ' (' + (b.barcode || 'N/A') + ')')
        )
      ),
      React.createElement('h4', { style: { marginTop: '10px' } }, 'Activity'),
      React.createElement('ul', null,
        (details.activities || []).slice(0, 5).map(a =>
          React.createElement('li', { key: a.id },
            a.activity_type + ' - ' + a.description)
        )
      )
    ),

    // Action button
    React.createElement('button', {
      onClick: onAction,
      style: styles.buttonPrimary,
      style: { ...styles.buttonPrimary, width: '100%', marginTop: '10px' }
    }, 'Manage Order')
  );
}
```

### 10. DropoffTab Component

```javascript
function DropoffTab({ offices, drivers }) {
  const { filters } = React.useContext(FilterContext);
  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      const result = await SupabaseQueries.getDropoffOrders(filters);
      setOrders(result.boxes || []);
      setLoading(false);
    })();
  }, [filters]);

  return React.createElement('div', { style: styles.tabContent },
    React.createElement(FilterBar, { offices, drivers }),

    loading && React.createElement('p', { style: { padding: '20px' } }, 'Loading...'),

    !loading && orders.length === 0 &&
    React.createElement('p', { style: { padding: '20px', textAlign: 'center' } },
      'No orders in transit.'),

    !loading && orders.length > 0 &&
    React.createElement('div', { style: styles.cardGrid },
      orders.map(box =>
        React.createElement(DropoffCard, {
          key: box.id,
          box: box,
          order: box.orders
        })
      )
    )
  );
}

function DropoffCard({ box, order }) {
  const progressPct = Math.random() * 100; // Calculate from order.delivered_boxes / order.total_boxes
  
  return React.createElement('div', { style: styles.card },
    React.createElement('div', { style: styles.cardHeader },
      React.createElement('div', null,
        React.createElement('h3', null, 'Order #' + box.order_id.substring(0, 8)),
        React.createElement('p', null, order?.recipient_name || 'Unknown recipient')
      ),
      React.createElement('span', { style: { ...styles.badge, backgroundColor: '#FF9500' } },
        box.status.toUpperCase())
    ),

    React.createElement('div', { style: styles.cardBody },
      React.createElement('p', null, 'Address: ' + (order?.recipient_address || 'N/A')),
      React.createElement('p', null, 'Phone: ' + (order?.recipient_phone || 'N/A')),

      // Progress bar
      React.createElement('div', { style: { marginTop: '10px' } },
        React.createElement('p', { style: { fontSize: '0.9em' } }, 'Progress:'),
        React.createElement('div', {
          style: {
            width: '100%',
            height: '8px',
            backgroundColor: '#eee',
            borderRadius: '4px',
            overflow: 'hidden'
          }
        },
          React.createElement('div', {
            style: {
              width: progressPct + '%',
              height: '100%',
              backgroundColor: '#4CAF50',
              transition: 'width 0.3s'
            }
          })
        ),
        React.createElement('p', { style: { fontSize: '0.8em', color: '#666' } },
          Math.round(progressPct) + '% complete')
      )
    )
  );
}
```

### 11. CompletedTab Component

```javascript
function CompletedTab({ offices, drivers }) {
  const { filters } = React.useContext(FilterContext);
  const [orders, setOrders] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      const result = await SupabaseQueries.getCompletedOrders(filters, filters.page);
      setOrders(result.orders || []);
      setTotal(result.total || 0);
      setLoading(false);
    })();
  }, [filters]);

  const handleExportCSV = () => {
    const csv = [
      ['Order ID', 'Customer', 'Driver', 'Boxes', 'Delivery Date', 'Payment Status'],
      ...orders.map(o => [
        o.order_id.substring(0, 8),
        o.orders?.customer_name || '',
        'Driver Name',
        '0', // calculate box count
        o.orders?.updated_at?.substring(0, 10) || '',
        o.orders?.payment_status || ''
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'completed-orders-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
  };

  return React.createElement('div', { style: styles.tabContent },
    React.createElement(FilterBar, { offices, drivers }),

    React.createElement('button', {
      onClick: handleExportCSV,
      style: styles.buttonSecondary,
      style: { ...styles.buttonSecondary, marginBottom: '10px' }
    }, 'Export CSV'),

    loading && React.createElement('p', { style: { padding: '20px' } }, 'Loading...'),

    !loading && orders.length === 0 &&
    React.createElement('p', { style: { padding: '20px', textAlign: 'center' } },
      'No completed orders.'),

    !loading && orders.length > 0 &&
    React.createElement('table', { style: styles.table },
      React.createElement('thead', null,
        React.createElement('tr', null,
          React.createElement('th', null, 'Order ID'),
          React.createElement('th', null, 'Customer'),
          React.createElement('th', null, 'Delivery Date'),
          React.createElement('th', null, 'Payment Status'),
          React.createElement('th', null, 'Actions')
        )
      ),
      React.createElement('tbody', null,
        orders.map(o =>
          React.createElement('tr', { key: o.order_id },
            React.createElement('td', null, o.order_id.substring(0, 8)),
            React.createElement('td', null, o.orders?.customer_name || 'Unknown'),
            React.createElement('td', null, o.orders?.updated_at?.substring(0, 10) || 'N/A'),
            React.createElement('td', null, 
              React.createElement('span', { 
                style: {
                  padding: '4px 8px',
                  backgroundColor: o.orders?.payment_status === 'paid' ? '#4CAF50' : '#FF9800',
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '0.85em'
                }
              }, o.orders?.payment_status?.toUpperCase() || 'PENDING')
            ),
            React.createElement('td', null,
              React.createElement('button', {
                onClick: () => alert('View details for ' + o.order_id),
                style: styles.buttonSmall
              }, 'Details')
            )
          )
        )
      )
    ),

    React.createElement('div', { style: styles.pagination },
      React.createElement('p', null, 
        'Page ' + (filters.page + 1) + ' of ' + Math.ceil(total / filters.page_size)),
      React.createElement('button', {
        onClick: () => console.log('Load previous page'),
        disabled: filters.page === 0,
        style: styles.buttonSmall
      }, 'Previous'),
      React.createElement('button', {
        onClick: () => console.log('Load next page'),
        disabled: (filters.page + 1) * filters.page_size >= total,
        style: styles.buttonSmall
      }, 'Next')
    )
  );
}
```

---

## STYLES

### 12. Inline Styling

```javascript
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#f5f5f5',
    fontFamily: "'IBM Plex Sans', system-ui, -apple-system, sans-serif"
  },
  header: {
    padding: '20px',
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #ddd',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
  },
  tabNav: {
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #ddd',
    padding: '0',
    display: 'flex'
  },
  tabList: {
    display: 'flex',
    padding: '0',
    margin: '0',
    listStyle: 'none'
  },
  tabButton: {
    flex: 1,
    padding: '12px 16px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#666',
    borderBottom: '3px solid transparent',
    transition: 'all 0.2s'
  },
  tabButtonActive: {
    color: '#000',
    borderBottomColor: '#000',
    backgroundColor: '#f9f9f9'
  },
  content: {
    flex: 1,
    overflow: 'auto'
  },
  tabContent: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column'
  },
  filterBar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  select: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: 'inherit'
  },
  input: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px'
  },
  buttonPrimary: {
    padding: '10px 16px',
    backgroundColor: '#000',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  buttonSecondary: {
    padding: '10px 16px',
    backgroundColor: '#f0f0f0',
    color: '#000',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  buttonSmall: {
    padding: '6px 12px',
    backgroundColor: '#f0f0f0',
    color: '#000',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '15px'
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    overflow: 'hidden'
  },
  cardHeader: {
    padding: '15px',
    borderBottom: '1px solid #eee',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardBody: {
    padding: '15px',
    fontSize: '14px'
  },
  expandedDetails: {
    padding: '15px',
    backgroundColor: '#f9f9f9',
    borderTop: '1px solid #eee',
    fontSize: '12px'
  },
  badge: {
    display: 'inline-block',
    padding: '4px 12px',
    backgroundColor: '#007AFF',
    color: '#ffffff',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    backgroundColor: '#ffffff'
  },
  pagination: {
    padding: '15px',
    display: 'flex',
    justifyContent: 'center',
    gap: '10px',
    marginTop: '20px'
  }
};
```

---

## ROOT RENDER

### 13. Mount React App

```javascript
// At the very end of the IIFE, before closing parens:

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(HQUnifiedTabs));

})();  // Close IIFE

// WhatsApp fu-div (exactly 5 closing parens):
// )))))
// ↑↑↑↑↑ 5 parens as required
```

---

## CHECKLIST FOR IMPLEMENTATION

- [ ] Copy filter context & reducer
- [ ] Implement SupabaseQueries service (copy all functions)
- [ ] Implement RealTimeService (subscriptions)
- [ ] Build HQUnifiedTabs (main component)
- [ ] Build TabNavigation
- [ ] Build FilterBar
- [ ] Build PickupTab + OrderCard
- [ ] Build DropoffTab + DropoffCard
- [ ] Build CompletedTab with table
- [ ] Add inline styles
- [ ] Test auth check (HQ role only)
- [ ] Test filters (office, driver, date range)
- [ ] Test real-time subscriptions
- [ ] Test CSV export
- [ ] Smoke tests (147 tests)
- [ ] Deploy to Netlify

---

**Document:** PHASE4-IMPLEMENTATION-GUIDE.md  
**Version:** 1.0  
**Date:** May 26, 2026 @ 21:03 EDT  
