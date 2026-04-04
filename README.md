# Marketplace Backend — API Reference

## Setup

```bash
npm install
cp .env.example .env          # fill in DB credentials and JWT_SECRET
psql -U postgres -d marketplace -f schema.sql
psql -U postgres -d marketplace -f seed.sql
npm run dev                   # or npm start
```

---

## Authentication

All protected routes require:
```
Authorization: Bearer <token>
```

---

## Endpoints

### Auth
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | /api/auth/register | Public | Register buyer or seller |
| POST | /api/auth/login | Public | Login, returns JWT |
| GET | /api/auth/me | Any | Get own user info + wallet balance |

**Register buyer:**
```json
{ "full_name": "Ali Raza", "email": "ali@example.com", "password": "pass123", "role": "buyer", "city": "Karachi" }
```

**Register seller:**
```json
{ "full_name": "Tariq", "email": "t@shop.pk", "password": "pass123", "role": "seller", "shop_name": "TechZone", "preferred_delivery_service_id": 1 }
```

---

### Products
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | /api/products | Public | Browse catalogue (filter/search/paginate) |
| GET | /api/products/:id | Public | Single product with images |
| POST | /api/products | Seller | Create new product |
| PATCH | /api/products/:id | Seller | Update own product |
| DELETE | /api/products/:id | Seller | Soft-delete own product |
| GET | /api/products/categories/all | Public | List all categories |

**Query params for GET /api/products:**
- `search=cricket bat` — full-text search using GIN index
- `category=Mobile Phones`
- `min_price=10000&max_price=50000`
- `seller_id=7`
- `page=1&limit=20`

---

### Orders
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | /api/orders | Buyer | Place a new order |
| POST | /api/orders/:id/confirm | Buyer | Confirm order (deducts wallet via trigger) |
| GET | /api/orders/my | Buyer | Own order history |
| GET | /api/orders/seller | Seller | Incoming orders |
| PATCH | /api/orders/:id/status | Seller | Update status (packed/shipped/delivered) |
| GET | /api/orders/:id | Buyer/Seller/Admin | Order detail with items |

**Place order — delivery_service_id is optional (per-order override):**
```json
{
  "seller_id": 7,
  "shipping_address": "House 5, Block B, Karachi",
  "items": [{"product_id": 30, "quantity": 1}],
  "delivery_service_id": null
}
```
If `delivery_service_id` is null, the API automatically resolves the seller's `preferred_delivery_service_id` and uses it to calculate the delivery fee.

**Update order status (seller can also override courier here):**
```json
{ "status": "shipped", "delivery_service_id": 2 }
```

---

### Wallet
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | /api/wallet | Any | Get own wallet balance |
| POST | /api/wallet/topup | Any | Top up wallet |
| GET | /api/wallet/transactions | Any | Transaction history |

**Top up:**
```json
{ "amount": 5000, "reference_no": "JAZZ-TXN-12345" }
```

---

### Seller
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | /api/seller/dashboard | Seller | Aggregated stats (uses DB view) |
| GET | /api/seller/profile | Seller | Own shop profile |
| PATCH | /api/seller/profile | Seller | Update shop info + preferred courier |
| GET | /api/seller/products | Seller | Own product listings |
| POST | /api/seller/tracking | Seller | Add/update tracking info for an order |

**Update preferred courier:**
```json
{ "preferred_delivery_service_id": 2 }
```

---

### Admin
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | /api/admin/stats | Admin | Platform-level stats |
| GET | /api/admin/users | Admin | All users (filter by role) |
| PATCH | /api/admin/users/:id/status | Admin | Activate/deactivate user |
| PATCH | /api/admin/sellers/:id/verify | Admin | Verify/unverify seller |
| GET | /api/admin/orders | Admin | All orders (filter by status) |
| GET | /api/admin/delivery-services | Admin | All couriers |
| POST | /api/admin/delivery-services | Admin | Add new courier |
| PATCH | /api/admin/delivery-services/:id | Admin | Update courier |

---

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/delivery-services | List active couriers (for checkout UI) |
| GET | /api/health | Health check |
