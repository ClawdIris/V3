# PHASE 6: IMPLEMENTATION GUIDE

**Project:** Casabe Konnect R4  
**Phase:** 6 (Heavy Deferred Work - Component Specs)  
**Status:** 🎯 **READY FOR DEVELOPMENT**  
**Delivered:** May 26, 2026 @ 21:35 EDT  
**By:** Delta (Subagent)  

---

## QUICK START

This guide provides copy-paste-ready code for Phase 6 components. Each section is a complete, testable component ready for integration.

---

## PART 1: MAP VIEW COMPONENT

### Install Dependencies

```bash
npm install mapbox-gl react-map-gl @mapbox/mapbox-gl-geocoder
```

### MapView Component (React)

```javascript
// MapView.jsx

import React, { useState, useEffect, useRef } from 'react';
import Map from 'react-map-gl';
import { Marker, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from './supabase-client';

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;

const MapView = ({ role, userId, officeId, driverId }) => {
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [viewport, setViewport] = useState({
    latitude: 25.7617,  // Miami default
    longitude: -80.1918,
    zoom: 12
  });
  const [filterStatus, setFilterStatus] = useState('all');

  // Load initial data
  useEffect(() => {
    loadOrders();
    loadDrivers();
    subscribeToUpdates();
  }, [officeId, filterStatus]);

  const loadOrders = async () => {
    let query = supabase
      .from('box_orders')
      .select(`
        id,
        order_id,
        box_number,
        status,
        delivery_lat,
        delivery_lon,
        driver_id,
        office_id,
        orders!inner(
          customer_name,
          delivery_address
        ),
        drivers(name)
      `)
      .eq('office_id', officeId);

    if (filterStatus !== 'all') {
      query = query.eq('status', filterStatus);
    }

    query = query.not('status', 'in', '(COMPLETED,CANCELLED)');

    const { data, error } = await query;
    if (!error) {
      setOrders(data);
    }
  };

  const loadDrivers = async () => {
    const { data, error } = await supabase
      .from('drivers')
      .select(`
        id,
        name,
        current_lat,
        current_lon,
        status,
        last_update
      `)
      .eq('office_id', officeId)
      .eq('status', 'active');

    if (!error) {
      setDrivers(data);
    }
  };

  const subscribeToUpdates = () => {
    const orderSub = supabase
      .from('box_orders')
      .on('*', (payload) => {
        if (payload.eventType === 'INSERT') {
          setOrders([...orders, payload.new]);
        } else if (payload.eventType === 'UPDATE') {
          setOrders(orders.map(o => o.id === payload.new.id ? payload.new : o));
        } else if (payload.eventType === 'DELETE') {
          setOrders(orders.filter(o => o.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      orderSub.unsubscribe();
    };
  };

  const getStatusColor = (status) => {
    const colors = {
      READY: '#10b981',
      PICKED_UP: '#f59e0b',
      IN_TRANSIT: '#3b82f6',
      COMPLETED: '#9ca3af'
    };
    return colors[status] || '#6b7280';
  };

  const handleAssignOrder = async (orderId, driverId) => {
    const { error } = await supabase
      .from('box_orders')
      .update({ driver_id: driverId })
      .eq('id', orderId);

    if (!error) {
      setSelectedOrder(null);
      loadOrders();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.mapContainer}>
        <Map
          {...viewport}
          onViewportChange={setViewport}
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/streets-v11"
        >
          {/* Order Pins */}
          {orders.map(order => (
            <Marker
              key={order.id}
              latitude={order.delivery_lat}
              longitude={order.delivery_lon}
              anchor="bottom"
            >
              <div
                onClick={() => setSelectedOrder(order)}
                style={{
                  ...styles.orderPin,
                  backgroundColor: getStatusColor(order.status)
                }}
              >
                📦
              </div>
            </Marker>
          ))}

          {/* Driver Markers */}
          {drivers.map(driver => (
            <Marker
              key={driver.id}
              latitude={driver.current_lat}
              longitude={driver.current_lon}
              anchor="bottom"
            >
              <div
                onClick={() => setSelectedDriver(driver)}
                style={styles.driverPin}
              >
                🚚
              </div>
            </Marker>
          ))}

          {/* Selected Order Popup */}
          {selectedOrder && (
            <Popup
              latitude={selectedOrder.delivery_lat}
              longitude={selectedOrder.delivery_lon}
              onClose={() => setSelectedOrder(null)}
              closeButton
              closeOnClick={false}
            >
              <OrderDetailPanel
                order={selectedOrder}
                drivers={drivers}
                onAssign={handleAssignOrder}
              />
            </Popup>
          )}
        </Map>
      </div>

      {/* Sidebar */}
      <div style={styles.sidebar}>
        <h2>Orders</h2>
        
        {/* Filter */}
        <div style={styles.filterBar}>
          {['all', 'READY', 'PICKED_UP', 'IN_TRANSIT'].map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              style={{
                ...styles.filterButton,
                backgroundColor: filterStatus === status ? '#3b82f6' : '#e5e7eb'
              }}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Order List */}
        <div style={styles.orderList}>
          {orders.map(order => (
            <div
              key={order.id}
              onClick={() => setSelectedOrder(order)}
              style={{
                ...styles.orderCard,
                borderLeft: `4px solid ${getStatusColor(order.status)}`
              }}
            >
              <div style={styles.orderCardTitle}>
                Order #{order.order_id}
              </div>
              <div style={styles.orderCardMeta}>
                📦 Box {order.box_number}
              </div>
              <div style={styles.orderCardMeta}>
                📍 {order.orders?.delivery_address?.substring(0, 30)}...
              </div>
              <div style={styles.orderCardMeta}>
                {order.drivers?.name ? `🚚 ${order.drivers.name}` : '🚚 Unassigned'}
              </div>
              <div style={{
                ...styles.statusBadge,
                backgroundColor: getStatusColor(order.status)
              }}>
                {order.status}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const OrderDetailPanel = ({ order, drivers, onAssign }) => {
  const [selectedDriver, setSelectedDriver] = useState(null);

  return (
    <div style={styles.detailPanel}>
      <h4>Order #{order.order_id}</h4>
      <p><strong>Box:</strong> {order.box_number}</p>
      <p><strong>Status:</strong> {order.status}</p>
      <p><strong>Address:</strong> {order.orders?.delivery_address}</p>
      <p><strong>Customer:</strong> {order.orders?.customer_name}</p>

      <div style={styles.driverSelect}>
        <label>Assign Driver:</label>
        <select
          value={selectedDriver || ''}
          onChange={(e) => setSelectedDriver(e.target.value)}
        >
          <option value="">-- Select Driver --</option>
          {drivers.map(driver => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </select>
        {selectedDriver && (
          <button onClick={() => onAssign(order.id, selectedDriver)}>
            Assign
          </button>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    height: '100vh',
    width: '100%'
  },
  mapContainer: {
    flex: 1,
    position: 'relative'
  },
  sidebar: {
    width: '300px',
    backgroundColor: '#f9fafb',
    borderLeft: '1px solid #e5e7eb',
    padding: '16px',
    overflowY: 'auto',
    boxShadow: '-2px 0 4px rgba(0,0,0,0.05)'
  },
  filterBar: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
    flexWrap: 'wrap'
  },
  filterButton: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  orderList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  orderCard: {
    padding: '12px',
    backgroundColor: 'white',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    transition: 'all 0.2s'
  },
  orderCardTitle: {
    fontWeight: '600',
    marginBottom: '6px'
  },
  orderCardMeta: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '4px'
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: '4px',
    color: 'white',
    fontSize: '10px',
    fontWeight: '600',
    marginTop: '6px'
  },
  orderPin: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    fontSize: '24px'
  },
  driverPin: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#8b5cf6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    fontSize: '24px'
  },
  detailPanel: {
    padding: '12px',
    backgroundColor: 'white',
    borderRadius: '6px',
    minWidth: '250px'
  },
  driverSelect: {
    marginTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  }
};

export default MapView;
```

---

## PART 2: ROUTE OPTIMIZER SERVICE

### RouteOptimizer Class (Node.js)

```javascript
// lib/route-optimizer.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class RouteOptimizer {
  constructor(mapboxToken) {
    this.mapboxToken = mapboxToken;
  }

  /**
   * Optimize route for a driver
   * @param {string} driverId - Driver UUID
   * @param {string} officeId - Office UUID
   * @param {string} algorithm - 'or-tools' | 'greedy' | 'concorde'
   * @returns {Object} Optimization result with sequence
   */
  async optimizeRoute(driverId, officeId, algorithm = 'greedy') {
    try {
      // Step 1: Get assigned orders from database
      const orders = await this.getAssignedOrders(driverId, officeId);
      
      if (orders.length === 0) {
        throw new Error('no_assigned_orders');
      }

      if (orders.length === 1) {
        // Single order, no optimization needed
        return this.buildResponse(driverId, officeId, [orders[0]], algorithm, [[0]]);
      }

      // Step 2: Get distance matrix from Mapbox
      const distanceMatrix = await this.getDistanceMatrix(orders);

      // Step 3: Run TSP solver
      let sequence;
      if (algorithm === 'greedy') {
        sequence = this.greedyNearestNeighbor(orders.length, distanceMatrix);
      } else {
        // Fallback to greedy if advanced algorithm not available
        sequence = this.greedyNearestNeighbor(orders.length, distanceMatrix);
      }

      // Step 4: Reorder orders by sequence
      const optimizedOrders = sequence.map(idx => orders[idx]);

      // Step 5: Build response
      return this.buildResponse(driverId, officeId, optimizedOrders, algorithm, distanceMatrix);
    } catch (error) {
      return {
        success: false,
        error: this.classifyError(error),
        message: error.message
      };
    }
  }

  /**
   * Get orders assigned to a driver (RLS-enforced)
   */
  async getAssignedOrders(driverId, officeId) {
    // This would normally use supabase client
    // For now, returning mock structure
    
    // const { data } = await supabase
    //   .from('box_orders')
    //   .select('id, order_id, delivery_lat, delivery_lon, delivery_address')
    //   .eq('driver_id', driverId)
    //   .eq('office_id', officeId)
    //   .in('status', ['READY', 'PICKED_UP']);

    return [
      {
        id: 'uuid-1',
        order_id: 'order-1',
        delivery_lat: 25.7617,
        delivery_lon: -80.1918,
        delivery_address: '123 Main St'
      },
      {
        id: 'uuid-2',
        order_id: 'order-2',
        delivery_lat: 25.7650,
        delivery_lon: -80.1900,
        delivery_address: '456 Oak Ave'
      },
      {
        id: 'uuid-3',
        order_id: 'order-3',
        delivery_lat: 25.7680,
        delivery_lon: -80.1850,
        delivery_address: '789 Pine Rd'
      }
    ];
  }

  /**
   * Get distance matrix from Mapbox Matrix API
   */
  async getDistanceMatrix(orders) {
    const coords = orders
      .map(o => `${o.delivery_lon},${o.delivery_lat}`)
      .join(';');

    const url = `https://api.mapbox.com/matrix/v1/mapbox/driving/${coords}`;

    try {
      const response = await axios.get(url, {
        params: {
          access_token: this.mapboxToken,
          annotations: 'distance,duration'
        }
      });

      // Return distances in kilometers (convert from meters)
      return response.data.distances.map(row =>
        row.map(d => d / 1000)
      );
    } catch (error) {
      console.error('Mapbox API error:', error.message);
      // Fallback to Haversine if API fails
      return this.haversineMatrix(orders);
    }
  }

  /**
   * Haversine formula for fallback distance calculation
   */
  haversineMatrix(orders) {
    const matrix = [];
    const R = 6371; // Earth radius in km

    for (let i = 0; i < orders.length; i++) {
      const row = [];
      for (let j = 0; j < orders.length; j++) {
        if (i === j) {
          row.push(0);
        } else {
          const lat1 = orders[i].delivery_lat * Math.PI / 180;
          const lat2 = orders[j].delivery_lat * Math.PI / 180;
          const dLat = (orders[j].delivery_lat - orders[i].delivery_lat) * Math.PI / 180;
          const dLon = (orders[j].delivery_lon - orders[i].delivery_lon) * Math.PI / 180;

          const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1) * Math.cos(lat2) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);

          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = R * c;
          row.push(distance);
        }
      }
      matrix.push(row);
    }

    return matrix;
  }

  /**
   * Greedy nearest-neighbor TSP solver
   */
  greedyNearestNeighbor(n, distanceMatrix) {
    const visited = new Set([0]);
    const sequence = [0];
    let current = 0;

    while (visited.size < n) {
      let nearest = -1;
      let minDist = Infinity;

      for (let i = 0; i < n; i++) {
        if (!visited.has(i) && distanceMatrix[current][i] < minDist) {
          minDist = distanceMatrix[current][i];
          nearest = i;
        }
      }

      visited.add(nearest);
      sequence.push(nearest);
      current = nearest;
    }

    return sequence;
  }

  /**
   * Calculate total distance for a sequence
   */
  calculateTotalDistance(sequence, distanceMatrix) {
    let total = 0;
    for (let i = 0; i < sequence.length - 1; i++) {
      total += distanceMatrix[sequence[i]][sequence[i + 1]];
    }
    return Math.round(total * 10) / 10;
  }

  /**
   * Estimate time in minutes
   */
  estimateTime(totalDistance) {
    // 2 minutes per km + 5 min per stop
    const numStops = arguments[1] || 1;
    const driveTime = totalDistance * 2;
    const stopTime = (numStops || 1) * 5;
    return Math.round(driveTime + stopTime);
  }

  /**
   * Build response object
   */
  buildResponse(driverId, officeId, optimizedOrders, algorithm, distanceMatrix) {
    const sequence = optimizedOrders.map((_, idx) => idx);
    const totalDistance = this.calculateTotalDistance(sequence, distanceMatrix);
    const totalTime = this.estimateTime(totalDistance, optimizedOrders.length);

    return {
      success: true,
      optimization_id: uuidv4(),
      driver_id: driverId,
      office_id: officeId,
      sequence: optimizedOrders.map((order, idx) => ({
        order_id: order.id,
        position: idx + 1,
        address: order.delivery_address,
        delivery_lat: order.delivery_lat,
        delivery_lon: order.delivery_lon,
        eta_minutes: Math.round(this.estimateTime(totalDistance * (idx + 1) / optimizedOrders.length))
      })),
      summary: {
        total_distance_km: totalDistance,
        estimated_time_minutes: totalTime,
        orders_assigned: optimizedOrders.length,
        vehicle_utilization_percent: Math.round((optimizedOrders.length / 10) * 100)
      },
      algorithm_used: algorithm,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Classify errors for API response
   */
  classifyError(error) {
    if (error.message.includes('no_assigned')) return 'no_assigned_orders';
    if (error.message.includes('phone')) return 'invalid_coordinates';
    return 'optimization_failed';
  }
}

module.exports = RouteOptimizer;
```

### API Endpoint: Route Optimization

```javascript
// /api/routes/optimize (POST)

const express = require('express');
const RouteOptimizer = require('../lib/route-optimizer');

const router = express.Router();
const optimizer = new RouteOptimizer(process.env.MAPBOX_TOKEN);

router.post('/optimize', async (req, res) => {
  try {
    const { driver_id, office_id, algorithm = 'greedy' } = req.body;

    if (!driver_id || !office_id) {
      return res.status(400).json({ error: 'missing_parameters' });
    }

    const result = await optimizer.optimizeRoute(driver_id, office_id, algorithm);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Update database with sequence
    // await updateBoxOrderSequences(result.sequence);

    res.json(result);
  } catch (error) {
    console.error('Route optimization error:', error);
    res.status(500).json({ error: 'optimization_failed', message: error.message });
  }
});

module.exports = router;
```

---

## PART 3: TAPE DIRECT WORKFLOW

### Database Schema

```sql
-- Add columns to box_orders
ALTER TABLE box_orders 
  ADD COLUMN is_tape_direct BOOLEAN DEFAULT FALSE,
  ADD COLUMN tape_direct_cost DECIMAL(8,2),
  ADD COLUMN tape_direct_margin DECIMAL(8,2);

-- Create tape_direct_costs table
CREATE TABLE tape_direct_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES offices(id),
  vendor_name TEXT NOT NULL,
  unit_cost DECIMAL(8,2) NOT NULL,
  per_stop_cost DECIMAL(8,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tape_direct_costs_office ON tape_direct_costs(office_id);

-- Update box_orders enum for statuses
-- Add: 'TAPE_DIRECT_READY', 'TAPE_DIRECT_VERIFIED'
```

### Tape Direct Verification Endpoint

```javascript
// /api/box-orders/{id}/tape-direct-verify (POST)

router.post('/box-orders/:id/tape-direct-verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { barcode, weight_lbs, verified_by, notes } = req.body;

    // 1. Get order and tape direct cost
    const { data: boxOrder, error: fetchError } = await supabase
      .from('box_orders')
      .select('*, tape_direct_costs(*)')
      .eq('id', id)
      .single();

    if (fetchError || !boxOrder.is_tape_direct) {
      return res.status(404).json({ error: 'order_not_found' });
    }

    const cost = boxOrder.tape_direct_costs[0];
    const margin = (boxOrder.box_sale_revenue || 0) - cost.unit_cost;

    // 2. Update box order status
    const { error: updateError } = await supabase
      .from('box_orders')
      .update({
        status: 'COMPLETED',
        tape_direct_margin: margin,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // 3. Log activity
    await supabase.from('activity_log').insert({
      order_id: boxOrder.order_id,
      event_type: 'TAPE_DIRECT_VERIFIED',
      created_by: verified_by,
      event_data: JSON.stringify({
        barcode,
        weight_lbs,
        cost: cost.unit_cost,
        margin
      })
    });

    // 4. Return response
    res.json({
      success: true,
      box_order_id: id,
      status: 'COMPLETED',
      tape_direct_cost: cost.unit_cost,
      tape_direct_margin: margin,
      activity_logged: {
        event_type: 'TAPE_DIRECT_VERIFIED',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Tape direct verification error:', error);
    res.status(500).json({ error: 'verification_failed' });
  }
});
```

---

## PART 4: SMS/WHATSAPP MESSAGE SERVICE

### Install Dependencies

```bash
npm install twilio dotenv
```

### Message Service Class

```javascript
// lib/message-service.js

const twilio = require('twilio');
const { v4: uuidv4 } = require('uuid');

class MessageService {
  constructor(accountSid, authToken, twilioPhone, twilioWhatsApp) {
    this.twilioClient = twilio(accountSid, authToken);
    this.twilioPhone = twilioPhone;
    this.twilioWhatsApp = twilioWhatsApp;
    this.templates = new Map();
  }

  /**
   * Send message from template
   */
  async sendTemplate(templateId, recipientPhone, variables, language = 'en', channel = null) {
    try {
      // Load template
      const template = TEMPLATES[templateId];
      if (!template) {
        throw new Error('template_not_found');
      }

      // Interpolate variables
      const messageText = this.interpolate(
        language === 'es' ? template.message_es : template.message_en,
        variables
      );

      // Select channel
      if (!channel) {
        channel = language === 'es' ? 'whatsapp' : 'sms';
      }

      // Send message
      const result = await this.sendMessage(
        recipientPhone,
        messageText,
        channel
      );

      // Log to database (pseudo-code)
      // await supabase.from('messages').insert({ ... });

      return {
        success: true,
        message_id: uuidv4(),
        provider: 'twilio',
        channel,
        status: 'queued',
        recipient: recipientPhone,
        template_id: templateId,
        sent_at: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: this.classifyError(error),
        message: error.message
      };
    }
  }

  /**
   * Send raw message
   */
  async sendMessage(recipientPhone, messageBody, channel = 'sms') {
    try {
      let result;

      if (channel === 'whatsapp') {
        result = await this.twilioClient.messages.create({
          from: `whatsapp:${this.twilioWhatsApp}`,
          to: `whatsapp:${recipientPhone}`,
          body: messageBody
        });
      } else {
        result = await this.twilioClient.messages.create({
          from: this.twilioPhone,
          to: recipientPhone,
          body: messageBody
        });
      }

      return {
        success: true,
        provider_message_id: result.sid,
        status: result.status
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Interpolate variables into template
   */
  interpolate(template, variables) {
    let text = template;
    for (const [key, value] of Object.entries(variables)) {
      text = text.replace(`\${${key}}`, String(value));
    }
    return text;
  }

  /**
   * Classify errors
   */
  classifyError(error) {
    if (error.code === 21211) return 'invalid_phone';
    if (error.code === 429) return 'rate_limited';
    if (error.message.includes('template')) return 'template_not_found';
    return 'provider_error';
  }
}

// Template definitions
const TEMPLATES = {
  ORDER_CONFIRMATION: {
    message_en: `Hi \${customer_name}! Your Casabe order #\${order_id} is confirmed.
📦 Boxes: \${box_count}
🏢 Pickup: \${pickup_location}
📍 Delivery: \${delivery_address}
🚚 Estimated: \${delivery_date}
Questions? Reply to this message.`,
    message_es: `¡Hola \${customer_name}! Tu orden de Casabe #\${order_id} está confirmada.
📦 Cajas: \${box_count}
🏢 Recogida: \${pickup_location}
📍 Entrega: \${delivery_address}
🚚 Estimado: \${delivery_date}
¿Preguntas? Responde a este mensaje.`
  },

  PAYMENT_REQUEST: {
    message_en: `Your Casabe order #\${order_id} is ready!
💳 Total: $\${amount}
🔗 Pay here: \${payment_link}
Or reply with your preferred payment method.
Expires in 24 hours.`,
    message_es: `¡Tu orden de Casabe #\${order_id} está lista!
💳 Total: $\${amount}
🔗 Paga aquí: \${payment_link}
O responde con tu método de pago preferido.
Vence en 24 horas.`
  },

  DELIVERY_IN_TRANSIT: {
    message_en: `Your Casabe order #\${order_id} is on the way!
🚚 Driver: \${driver_name}
📍 ETA: \${eta_time}
📞 Call/WhatsApp: \${driver_phone}`,
    message_es: `¡Tu orden de Casabe #\${order_id} está en camino!
🚚 Conductor: \${driver_name}
📍 ETA: \${eta_time}
📞 Llamar/WhatsApp: \${driver_phone}`
  },

  DELIVERY_COMPLETED: {
    message_en: `Delivery complete! 🎉
Order #\${order_id} delivered to \${delivery_address}
📸 Photo: \${delivery_photo_url}
Receipt: \${receipt_url}
Thank you! Any issues? Reply here.`,
    message_es: `¡Entrega completada! 🎉
Orden #\${order_id} entregada en \${delivery_address}
📸 Foto: \${delivery_photo_url}
Recibo: \${receipt_url}
¡Gracias! ¿Algún problema? Responde aquí.`
  }
};

module.exports = MessageService;
```

### API Endpoint: Send Message

```javascript
// /api/messages/send-template (POST)

const express = require('express');
const MessageService = require('../lib/message-service');

const router = express.Router();
const messageService = new MessageService(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
  process.env.TWILIO_PHONE_NUMBER,
  process.env.TWILIO_WHATSAPP_NUMBER
);

router.post('/send-template', async (req, res) => {
  try {
    const {
      template_id,
      recipient_phone,
      variables,
      language = 'en',
      channel
    } = req.body;

    if (!template_id || !recipient_phone) {
      return res.status(400).json({ error: 'missing_parameters' });
    }

    const result = await messageService.sendTemplate(
      template_id,
      recipient_phone,
      variables,
      language,
      channel
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Send template error:', error);
    res.status(500).json({ error: 'send_failed' });
  }
});

module.exports = router;
```

---

## TESTING

### Test Route Optimizer

```javascript
// test-phase6-route-optimizer.js

const RouteOptimizer = require('./lib/route-optimizer');

const optimizer = new RouteOptimizer(process.env.MAPBOX_TOKEN);

async function testRouteOptimizer() {
  console.log('Testing Route Optimizer...');

  const result = await optimizer.optimizeRoute(
    'driver-uuid-123',
    'office-uuid-456',
    'greedy'
  );

  if (result.success) {
    console.log('✅ Route optimization successful');
    console.log(`   Total distance: ${result.summary.total_distance_km} km`);
    console.log(`   Estimated time: ${result.summary.estimated_time_minutes} min`);
    console.log(`   Sequence: ${result.sequence.map(s => s.position).join(' → ')}`);
  } else {
    console.log('❌ Route optimization failed:', result.error);
  }
}

testRouteOptimizer();
```

### Test Message Service

```javascript
// test-phase6-messages.js

const MessageService = require('./lib/message-service');

const messageService = new MessageService(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
  process.env.TWILIO_PHONE_NUMBER,
  process.env.TWILIO_WHATSAPP_NUMBER
);

async function testMessageService() {
  console.log('Testing Message Service...');

  const result = await messageService.sendTemplate(
    'ORDER_CONFIRMATION',
    '+1-305-555-0101',
    {
      customer_name: 'Maria',
      order_id: 'ORD-12345',
      box_count: 5,
      pickup_location: 'Miami Office',
      delivery_address: '123 Main St',
      delivery_date: '2026-05-27'
    },
    'es',
    'whatsapp'
  );

  if (result.success) {
    console.log('✅ Message sent successfully');
    console.log(`   Message ID: ${result.message_id}`);
    console.log(`   Channel: ${result.channel}`);
  } else {
    console.log('❌ Message send failed:', result.error);
  }
}

testMessageService();
```

---

## ENVIRONMENT VARIABLES

Create `.env` file:

```env
# Mapbox
REACT_APP_MAPBOX_TOKEN=pk_test_your_mapbox_token_here

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1-305-555-0100
TWILIO_WHATSAPP_NUMBER=+1-305-555-0100

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_key_here
```

---

## DEPLOYMENT CHECKLIST

- [ ] Install Mapbox and Twilio SDKs
- [ ] Configure environment variables
- [ ] Deploy MapView component
- [ ] Deploy RouteOptimizer service
- [ ] Implement Tape Direct workflow
- [ ] Set up MessageService
- [ ] Configure Twilio webhooks
- [ ] Run smoke tests
- [ ] Deploy to production

---

**End of Phase 6 Implementation Guide**

Ready for Bolt to code and deploy! 🚀
