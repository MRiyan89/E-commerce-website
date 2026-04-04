const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { rows: [wallet] } = await pool.query(
      `SELECT wallet_id, balance, currency, updated_at FROM wallets WHERE user_id = $1`,
      [req.user.user_id]
    );
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

router.post('/topup', authenticate, async (req, res) => {
  const { amount, reference_no } = req.body;
  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [wallet] } = await client.query(
      `SELECT wallet_id, balance FROM wallets WHERE user_id = $1 AND is_active = TRUE FOR UPDATE`,
      [req.user.user_id]
    );
    if (!wallet) return res.status(404).json({ error: 'Wallet not found or inactive' });

    const balanceBefore = parseFloat(wallet.balance);
    const topupAmount   = parseFloat(parseFloat(amount).toFixed(2));
    const balanceAfter  = parseFloat((balanceBefore + topupAmount).toFixed(2));

    await client.query(
      `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE wallet_id = $2`,
      [balanceAfter, wallet.wallet_id]
    );

    const { rows: [txn] } = await client.query(
      `INSERT INTO wallet_transactions
         (wallet_id, txn_type, amount, balance_before, balance_after, description, reference_no)
       VALUES ($1, 'topup', $2, $3, $4, $5, COALESCE($6, gen_random_uuid()::TEXT))
       RETURNING *`,
      [wallet.wallet_id, topupAmount, balanceBefore, balanceAfter,
       `Wallet top-up of PKR ${topupAmount}`, reference_no || null]
    );

    await client.query('COMMIT');
    res.json({
      message: 'Wallet topped up successfully',
      new_balance: balanceAfter,
      transaction: txn
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Duplicate transaction reference' });
    console.error(err);
    res.status(500).json({ error: 'Top-up failed' });
  } finally {
    client.release();
  }
});

router.get('/transactions', authenticate, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  try {
    const { rows: [wallet] } = await pool.query(
      `SELECT wallet_id FROM wallets WHERE user_id = $1`, [req.user.user_id]
    );
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    const { rows } = await pool.query(
      `SELECT wt.*, o.status AS order_status
       FROM wallet_transactions wt
       LEFT JOIN orders o ON o.order_id = wt.order_id
       WHERE wt.wallet_id = $1
       ORDER BY wt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [wallet.wallet_id, parseInt(limit), offset]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
