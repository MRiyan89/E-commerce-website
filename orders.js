const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.post('/', authenticate, authorize('buyer'), async (req, res) => {
  const { seller_id, items, shipping_address, delivery_service_id, notes } = req.body;

  if (!seller_id || !items?.length || !shipping_address) {
    return res.status(400).json({ error: 'seller_id, items, and shipping_address are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [buyer] } = await client.query(
      `SELECT buyer_id FROM buyer_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    if (!buyer) return res.status(404).json({ error: 'Buyer profile not found' });

    let effectiveDeliveryId = delivery_service_id || null;
    if (!effectiveDeliveryId) {
      const { rows: [sp] } = await client.query(
        `SELECT preferred_delivery_service_id FROM seller_profiles WHERE seller_id = $1`, [seller_id]
      );
      effectiveDeliveryId = sp?.preferred_delivery_service_id || null;
    }

    let subtotal = 0;
    const lineItems = [];

    for (const item of items) {
      const { rows: [product] } = await client.query(
        `SELECT product_id, price, discount_pct, stock_qty, weight_kg, seller_id
         FROM products WHERE product_id = $1 AND is_active = TRUE FOR UPDATE`,
        [item.product_id]
      );
      if (!product) throw new Error(`Product ${item.product_id} not found`);
      if (product.seller_id !== parseInt(seller_id)) throw new Error(`Product ${item.product_id} does not belong to this seller`);
      if (product.stock_qty < item.quantity) throw new Error(`Insufficient stock for product ${item.product_id}`);

      const lineTotal = parseFloat(product.price) * item.quantity * (1 - product.discount_pct / 100);
      subtotal += lineTotal;
      lineItems.push({ ...product, quantity: item.quantity, lineTotal: parseFloat(lineTotal.toFixed(2)) });
    }

    let deliveryFee = 0;
    if (effectiveDeliveryId) {
      const totalWeight = lineItems.reduce((sum, i) => sum + (parseFloat(i.weight_kg || 0) * i.quantity), 0);
      const { rows: [courier] } = await client.query(
        `SELECT base_rate, per_kg_rate FROM delivery_services WHERE delivery_service_id = $1 AND is_active = TRUE`,
        [effectiveDeliveryId]
      );
      if (courier) {
        deliveryFee = parseFloat(courier.base_rate) + (totalWeight * parseFloat(courier.per_kg_rate));
        deliveryFee = parseFloat(deliveryFee.toFixed(2));
      }
    }

    subtotal = parseFloat(subtotal.toFixed(2));
    const totalAmount = parseFloat((subtotal + deliveryFee).toFixed(2));

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (buyer_id, seller_id, delivery_service_id, status, subtotal, delivery_fee, discount_amount, total_amount, shipping_address, notes)
       VALUES ($1, $2, $3, 'pending', $4, $5, 0, $6, $7, $8) RETURNING *`,
      [buyer.buyer_id, seller_id, delivery_service_id || null, subtotal, deliveryFee, totalAmount, shipping_address, notes || null]
    );

    for (const item of lineItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, discount_pct, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.order_id, item.product_id, item.quantity, item.price, item.discount_pct, item.lineTotal]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Order placed successfully',
      order_id: order.order_id,
      status: order.status,
      total_amount: order.total_amount,
      effective_courier_id: effectiveDeliveryId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message || 'Failed to place order' });
  } finally {
    client.release();
  }
});

router.post('/:id/confirm', authenticate, authorize('buyer'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [buyer] } = await client.query(
      `SELECT buyer_id FROM buyer_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const { rows: [order] } = await client.query(
      `SELECT * FROM orders WHERE order_id = $1 AND buyer_id = $2`, [req.params.id, buyer.buyer_id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending') return res.status(400).json({ error: `Cannot confirm order in '${order.status}' status` });

    const { rows: [updated] } = await client.query(
      `UPDATE orders SET status = 'confirmed' WHERE order_id = $1 RETURNING *`, [req.params.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Order confirmed and payment deducted', order: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message || 'Failed to confirm order' });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', authenticate, authorize('seller'), async (req, res) => {
  const { status, delivery_service_id } = req.body;
  const validStatuses = ['packed', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [sp] } = await client.query(
      `SELECT seller_id FROM seller_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const { rows: [order] } = await client.query(
      `SELECT * FROM orders WHERE order_id = $1 AND seller_id = $2`, [req.params.id, sp.seller_id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { rows: [updated] } = await client.query(
      `UPDATE orders SET status = $1,
        delivery_service_id = COALESCE($2, delivery_service_id)
       WHERE order_id = $3 RETURNING *`,
      [status, delivery_service_id || null, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ message: `Order status updated to ${status}`, order: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message || 'Failed to update order status' });
  } finally {
    client.release();
  }
});

router.get('/my', authenticate, authorize('buyer'), async (req, res) => {
  try {
    const { rows: [buyer] } = await pool.query(
      `SELECT buyer_id FROM buyer_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const { rows } = await pool.query(
      `SELECT * FROM vw_buyer_order_history WHERE buyer_id = $1 ORDER BY order_date DESC`,
      [buyer.buyer_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/seller', authenticate, authorize('seller'), async (req, res) => {
  const { status } = req.query;
  try {
    const { rows: [sp] } = await pool.query(
      `SELECT seller_id FROM seller_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const params = [sp.seller_id];
    let statusClause = '';
    if (status) { params.push(status); statusClause = `AND o.status = $2`; }

    const { rows } = await pool.query(
      `SELECT o.order_id, o.status, o.total_amount, o.created_at, o.shipping_address,
              o.delivery_service_id,
              COALESCE(ds_override.name, ds_pref.name) AS effective_courier,
              bp_user.full_name AS buyer_name,
              COUNT(oi.order_item_id) AS item_count,
              dt.tracking_number, dt.current_status AS tracking_status
       FROM orders o
       JOIN buyer_profiles bp  ON bp.buyer_id = o.buyer_id
       JOIN users bp_user       ON bp_user.user_id = bp.user_id
       JOIN seller_profiles sp  ON sp.seller_id = o.seller_id
       LEFT JOIN delivery_services ds_pref ON ds_pref.delivery_service_id = sp.preferred_delivery_service_id
       LEFT JOIN delivery_services ds_override ON ds_override.delivery_service_id = o.delivery_service_id
       LEFT JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN delivery_tracking dt ON dt.order_id = o.order_id
       WHERE o.seller_id = $1 ${statusClause}
       GROUP BY o.order_id, o.status, o.total_amount, o.created_at, o.shipping_address,
                o.delivery_service_id, ds_pref.name, ds_override.name,
                bp_user.full_name, dt.tracking_number, dt.current_status
       ORDER BY o.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows: [order] } = await pool.query(
      `SELECT o.*, sp.shop_name,
              COALESCE(ds_override.name, ds_pref.name) AS effective_courier,
              dt.tracking_number, dt.current_status AS tracking_status, dt.current_location,
              dt.estimated_delivery, dt.actual_delivery
       FROM orders o
       JOIN seller_profiles sp ON sp.seller_id = o.seller_id
       LEFT JOIN delivery_services ds_pref ON ds_pref.delivery_service_id = sp.preferred_delivery_service_id
       LEFT JOIN delivery_services ds_override ON ds_override.delivery_service_id = o.delivery_service_id
       LEFT JOIN delivery_tracking dt ON dt.order_id = o.order_id
       WHERE o.order_id = $1`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (req.user.role === 'buyer') {
      const { rows: [buyer] } = await pool.query(
        `SELECT buyer_id FROM buyer_profiles WHERE user_id = $1`, [req.user.user_id]
      );
      if (order.buyer_id !== buyer.buyer_id) return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.role === 'seller') {
      const { rows: [sp] } = await pool.query(
        `SELECT seller_id FROM seller_profiles WHERE user_id = $1`, [req.user.user_id]
      );
      if (order.seller_id !== sp.seller_id) return res.status(403).json({ error: 'Access denied' });
    }

    const { rows: items } = await pool.query(
      `SELECT oi.*, p.name AS product_name, p.sku
       FROM order_items oi JOIN products p ON p.product_id = oi.product_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );
    res.json({ ...order, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

module.exports = router;
