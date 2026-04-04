const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const adminOnly = [authenticate, authorize('admin')];

router.get('/users', ...adminOnly, async (req, res) => {
  const { role, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [parseInt(limit), offset];
  let roleClause = '';
  if (role) { params.unshift(role); roleClause = `WHERE u.role = $1`; }

  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at,
              w.balance AS wallet_balance
       FROM users u LEFT JOIN wallets w ON w.user_id = u.user_id
       ${roleClause}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.patch('/users/:id/status', ...adminOnly, async (req, res) => {
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false' });
  try {
    const { rows: [user] } = await pool.query(
      `UPDATE users SET is_active = $1 WHERE user_id = $2 RETURNING user_id, email, is_active`,
      [is_active, req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

router.patch('/sellers/:id/verify', ...adminOnly, async (req, res) => {
  const { is_verified } = req.body;
  if (typeof is_verified !== 'boolean') return res.status(400).json({ error: 'is_verified must be true or false' });
  try {
    const { rows: [sp] } = await pool.query(
      `UPDATE seller_profiles SET is_verified = $1 WHERE seller_id = $2 RETURNING seller_id, shop_name, is_verified`,
      [is_verified, req.params.id]
    );
    if (!sp) return res.status(404).json({ error: 'Seller not found' });
    res.json(sp);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update seller verification' });
  }
});

router.get('/orders', ...adminOnly, async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [];
  let whereClause = '';
  if (status) { params.push(status); whereClause = `WHERE o.status = $1`; }
  params.push(parseInt(limit), offset);

  try {
    const { rows } = await pool.query(
      `SELECT o.order_id, o.status, o.total_amount, o.created_at,
              bu.full_name AS buyer_name, su.full_name AS seller_name, sp.shop_name,
              COALESCE(ds_override.name, ds_pref.name) AS effective_courier
       FROM orders o
       JOIN buyer_profiles bp  ON bp.buyer_id   = o.buyer_id
       JOIN users bu            ON bu.user_id    = bp.user_id
       JOIN seller_profiles sp  ON sp.seller_id  = o.seller_id
       JOIN users su            ON su.user_id    = sp.user_id
       LEFT JOIN delivery_services ds_pref    ON ds_pref.delivery_service_id    = sp.preferred_delivery_service_id
       LEFT JOIN delivery_services ds_override ON ds_override.delivery_service_id = o.delivery_service_id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/delivery-services', ...adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM delivery_services ORDER BY name`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch delivery services' });
  }
});

router.post('/delivery-services', ...adminOnly, async (req, res) => {
  const { name, contact_phone, contact_email, base_rate, per_kg_rate, estimated_days_min, estimated_days_max } = req.body;
  if (!name || base_rate === undefined || !per_kg_rate || !estimated_days_min || !estimated_days_max) {
    return res.status(400).json({ error: 'name, base_rate, per_kg_rate, estimated_days_min, estimated_days_max required' });
  }
  try {
    const { rows: [ds] } = await pool.query(
      `INSERT INTO delivery_services (name, contact_phone, contact_email, base_rate, per_kg_rate, estimated_days_min, estimated_days_max)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, contact_phone || null, contact_email || null, base_rate, per_kg_rate, estimated_days_min, estimated_days_max]
    );
    res.status(201).json(ds);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Delivery service name already exists' });
    res.status(500).json({ error: 'Failed to create delivery service' });
  }
});

router.patch('/delivery-services/:id', ...adminOnly, async (req, res) => {
  const { name, base_rate, per_kg_rate, estimated_days_min, estimated_days_max, is_active } = req.body;
  try {
    const { rows: [ds] } = await pool.query(
      `UPDATE delivery_services SET
         name               = COALESCE($1, name),
         base_rate          = COALESCE($2, base_rate),
         per_kg_rate        = COALESCE($3, per_kg_rate),
         estimated_days_min = COALESCE($4, estimated_days_min),
         estimated_days_max = COALESCE($5, estimated_days_max),
         is_active          = COALESCE($6, is_active)
       WHERE delivery_service_id = $7 RETURNING *`,
      [name, base_rate, per_kg_rate, estimated_days_min, estimated_days_max, is_active, req.params.id]
    );
    if (!ds) return res.status(404).json({ error: 'Delivery service not found' });
    res.json(ds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update delivery service' });
  }
});

router.get('/stats', ...adminOnly, async (req, res) => {
  try {
    const [users, orders, revenue, products] = await Promise.all([
      pool.query(`SELECT role, COUNT(*) FROM users GROUP BY role`),
      pool.query(`SELECT status, COUNT(*) FROM orders GROUP BY status`),
      pool.query(`SELECT COALESCE(SUM(total_amount) FILTER (WHERE status='delivered'), 0) AS total_revenue FROM orders`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE is_active=TRUE) AS active, COUNT(*) FILTER (WHERE is_active=FALSE) AS inactive FROM products`),
    ]);
    res.json({
      users: users.rows,
      orders: orders.rows,
      revenue: revenue.rows[0],
      products: products.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
