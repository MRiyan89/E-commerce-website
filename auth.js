const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const pool    = require('../config/db');

router.post('/register', async (req, res) => {
  const { full_name, email, phone, password, role, shop_name, shop_description, city, preferred_delivery_service_id } = req.body;

  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ error: 'full_name, email, password, and role are required' });
  }
  if (!['buyer', 'seller'].includes(role)) {
    return res.status(400).json({ error: 'role must be buyer or seller' });
  }
  if (role === 'seller' && !shop_name) {
    return res.status(400).json({ error: 'shop_name is required for sellers' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hash = await bcrypt.hash(password, 12);

    const { rows: [user] } = await client.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING user_id, email, role`,
      [full_name, email, phone || null, hash, role]
    );

    await client.query(
      `INSERT INTO wallets (user_id, balance) VALUES ($1, 0)`,
      [user.user_id]
    );

    if (role === 'buyer') {
      await client.query(
        `INSERT INTO buyer_profiles (user_id, city) VALUES ($1, $2)`,
        [user.user_id, city || null]
      );
    } else {
      await client.query(
        `INSERT INTO seller_profiles (user_id, preferred_delivery_service_id, shop_name, shop_description, city)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.user_id, preferred_delivery_service_id || null, shop_name, shop_description || null, city || null]
      );
    }

    await client.query('COMMIT');

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ message: 'Account created', token, role: user.role });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email or shop name already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT user_id, email, password_hash, role, is_active FROM users WHERE email = $1`,
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ token, role: user.role, user_id: user.user_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', require('../middleware/auth').authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.full_name, u.email, u.phone, u.role, u.created_at,
              w.balance AS wallet_balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.user_id
       WHERE u.user_id = $1`,
      [req.user.user_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
