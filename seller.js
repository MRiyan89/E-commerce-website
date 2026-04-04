const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/dashboard', authenticate, authorize('seller'), async (req, res) => {
  try {
    const { rows: [sp] } = await pool.query(
      `SELECT seller_id FROM seller_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const { rows: [dashboard] } = await pool.query(
      `SELECT * FROM vw_seller_dashboard WHERE seller_id = $1`, [sp.seller_id]
    );
    res.json(dashboard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

router.get('/profile', authenticate, authorize('seller'), async (req, res) => {
  try {
    const { rows: [profile] } = await pool.query(
      `SELECT sp.*, ds.name AS preferred_courier_name, u.email, u.phone, u.full_name
       FROM seller_profiles sp
       JOIN users u ON u.user_id = sp.user_id
       LEFT JOIN delivery_services ds ON ds.delivery_service_id = sp.preferred_delivery_service_id
       WHERE sp.user_id = $1`,
      [req.user.user_id]
    );
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/profile', authenticate, authorize('seller'), async (req, res) => {
  const { shop_name, shop_description, business_address, city, preferred_delivery_service_id } = req.body;
  try {
    const { rows: [updated] } = await pool.query(
      `UPDATE seller_profiles SET
         shop_name                     = COALESCE($1, shop_name),
         shop_description              = COALESCE($2, shop_description),
         business_address              = COALESCE($3, business_address),
         city                          = COALESCE($4, city),
         preferred_delivery_service_id = COALESCE($5, preferred_delivery_service_id)
       WHERE user_id = $6 RETURNING *`,
      [shop_name, shop_description, business_address, city, preferred_delivery_service_id, req.user.user_id]
    );
    res.json(updated);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Shop name already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/products', authenticate, authorize('seller'), async (req, res) => {
  try {
    const { rows: [sp] } = await pool.query(
      `SELECT seller_id FROM seller_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS category
       FROM products p JOIN categories c ON c.category_id = p.category_id
       WHERE p.seller_id = $1 ORDER BY p.created_at DESC`,
      [sp.seller_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.post('/tracking', authenticate, authorize('seller'), async (req, res) => {
  const { order_id, tracking_number, current_status, current_location, estimated_delivery } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [sp] } = await client.query(
      `SELECT seller_id, preferred_delivery_service_id FROM seller_profiles WHERE user_id = $1`,
      [req.user.user_id]
    );
    const { rows: [order] } = await client.query(
      `SELECT * FROM orders WHERE order_id = $1 AND seller_id = $2`,
      [order_id, sp.seller_id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const effectiveCourierId = order.delivery_service_id || sp.preferred_delivery_service_id;
    if (!effectiveCourierId) return res.status(400).json({ error: 'No courier configured for this order' });

    const { rows: [tracking] } = await client.query(
      `INSERT INTO delivery_tracking
         (order_id, delivery_service_id, tracking_number, current_status, current_location, estimated_delivery)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (order_id) DO UPDATE SET
         tracking_number   = EXCLUDED.tracking_number,
         current_status    = EXCLUDED.current_status,
         current_location  = EXCLUDED.current_location,
         estimated_delivery= EXCLUDED.estimated_delivery,
         updated_at        = NOW()
       RETURNING *`,
      [order_id, effectiveCourierId, tracking_number || null,
       current_status || 'pickup_scheduled', current_location || null,
       estimated_delivery || null]
    );
    await client.query('COMMIT');
    res.status(201).json(tracking);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save tracking info' });
  } finally {
    client.release();
  }
});

module.exports = router;
