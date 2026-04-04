const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', async (req, res) => {
  const { category, search, min_price, max_price, seller_id, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [];
  const conditions = ['p.is_active = TRUE', 'p.stock_qty > 0'];

  if (search) {
    params.push(search);
    conditions.push(`to_tsvector('english', p.name) @@ plainto_tsquery('english', $${params.length})`);
  }
  if (category) {
    params.push(category);
    conditions.push(`c.name ILIKE $${params.length}`);
  }
  if (min_price) {
    params.push(parseFloat(min_price));
    conditions.push(`p.price >= $${params.length}`);
  }
  if (max_price) {
    params.push(parseFloat(max_price));
    conditions.push(`p.price <= $${params.length}`);
  }
  if (seller_id) {
    params.push(parseInt(seller_id));
    conditions.push(`p.seller_id = $${params.length}`);
  }

  const where = conditions.join(' AND ');
  params.push(parseInt(limit));
  params.push(offset);

  try {
    const { rows } = await pool.query(
      `SELECT p.product_id, p.name, p.price, p.discount_pct,
              ROUND(p.price * (1 - p.discount_pct / 100), 2) AS effective_price,
              p.stock_qty, p.sku, p.weight_kg,
              c.name AS category, sp.shop_name AS seller, sp.seller_id,
              pi.image_url AS primary_image
       FROM products p
       JOIN categories c       ON c.category_id = p.category_id
       JOIN seller_profiles sp ON sp.seller_id  = p.seller_id
       LEFT JOIN product_images pi ON pi.product_id = p.product_id AND pi.is_primary = TRUE
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, params.length - 2);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM products p
       JOIN categories c       ON c.category_id = p.category_id
       JOIN seller_profiles sp ON sp.seller_id  = p.seller_id
       WHERE ${where}`,
      countParams
    );

    res.json({
      products: rows,
      pagination: {
        total: parseInt(countRows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countRows[0].count / parseInt(limit))
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS category, sp.shop_name, sp.rating AS seller_rating,
              sp.is_verified AS seller_verified
       FROM products p
       JOIN categories c       ON c.category_id = p.category_id
       JOIN seller_profiles sp ON sp.seller_id  = p.seller_id
       WHERE p.product_id = $1 AND p.is_active = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });

    const { rows: images } = await pool.query(
      `SELECT image_id, image_url, is_primary, display_order
       FROM product_images WHERE product_id = $1 ORDER BY display_order`,
      [req.params.id]
    );

    res.json({ ...rows[0], images });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

router.post('/', authenticate, authorize('seller'), async (req, res) => {
  const { category_id, name, description, price, discount_pct, stock_qty, weight_kg, sku } = req.body;
  if (!category_id || !name || !price) {
    return res.status(400).json({ error: 'category_id, name, and price are required' });
  }
  try {
    const { rows: [sp] } = await pool.query(
      `SELECT seller_id FROM seller_profiles WHERE user_id = $1`,
      [req.user.user_id]
    );
    if (!sp) return res.status(404).json({ error: 'Seller profile not found' });

    const { rows: [product] } = await pool.query(
      `INSERT INTO products (seller_id, category_id, name, description, price, discount_pct, stock_qty, weight_kg, sku)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [sp.seller_id, category_id, name, description || null, price,
       discount_pct || 0, stock_qty || 0, weight_kg || null, sku || null]
    );
    res.status(201).json(product);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'SKU already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

router.patch('/:id', authenticate, authorize('seller'), async (req, res) => {
  const { name, description, price, discount_pct, stock_qty, weight_kg, is_active, category_id } = req.body;
  try {
    const { rows: [sp] } = await pool.query(
      `SELECT seller_id FROM seller_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const { rows: [product] } = await pool.query(
      `SELECT * FROM products WHERE product_id = $1`, [req.params.id]
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.seller_id !== sp.seller_id) return res.status(403).json({ error: 'Not your product' });

    const { rows: [updated] } = await pool.query(
      `UPDATE products SET
         name        = COALESCE($1, name),
         description = COALESCE($2, description),
         price       = COALESCE($3, price),
         discount_pct= COALESCE($4, discount_pct),
         stock_qty   = COALESCE($5, stock_qty),
         weight_kg   = COALESCE($6, weight_kg),
         is_active   = COALESCE($7, is_active),
         category_id = COALESCE($8, category_id)
       WHERE product_id = $9 RETURNING *`,
      [name, description, price, discount_pct, stock_qty, weight_kg, is_active, category_id, req.params.id]
    );
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

router.delete('/:id', authenticate, authorize('seller'), async (req, res) => {
  try {
    const { rows: [sp] } = await pool.query(
      `SELECT seller_id FROM seller_profiles WHERE user_id = $1`, [req.user.user_id]
    );
    const { rowCount } = await pool.query(
      `UPDATE products SET is_active = FALSE
       WHERE product_id = $1 AND seller_id = $2`,
      [req.params.id, sp.seller_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Product not found or not yours' });
    res.json({ message: 'Product deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

router.get('/categories/all', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT category_id, name, parent_id, description
       FROM categories WHERE is_active = TRUE ORDER BY parent_id NULLS FIRST, name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

module.exports = router;
