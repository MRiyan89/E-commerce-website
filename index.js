require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/wallet',   require('./routes/wallet'));
app.use('/api/seller',   require('./routes/seller'));
app.use('/api/admin',    require('./routes/admin'));

app.get('/api/delivery-services', async (req, res) => {
  const pool = require('./config/db');
  try {
    const { rows } = await pool.query(
      `SELECT delivery_service_id, name, base_rate, per_kg_rate, estimated_days_min, estimated_days_max
       FROM delivery_services WHERE is_active = TRUE ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch delivery services' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Marketplace API running on port ${PORT}`);
});

module.exports = app;
