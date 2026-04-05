CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
DROP TABLE IF EXISTS delivery_tracking      CASCADE;
DROP TABLE IF EXISTS order_items            CASCADE;
DROP TABLE IF EXISTS orders                 CASCADE;
DROP TABLE IF EXISTS wallet_transactions    CASCADE;
DROP TABLE IF EXISTS wallets                CASCADE;
DROP TABLE IF EXISTS product_images         CASCADE;
DROP TABLE IF EXISTS products               CASCADE;
DROP TABLE IF EXISTS categories             CASCADE;
DROP TABLE IF EXISTS delivery_services      CASCADE;
DROP TABLE IF EXISTS seller_profiles        CASCADE;
DROP TABLE IF EXISTS buyer_profiles         CASCADE;
DROP TABLE IF EXISTS admin_profiles         CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;
CREATE TABLE users (
    user_id       SERIAL          PRIMARY KEY,
    full_name     VARCHAR(100)    NOT NULL,
    email         VARCHAR(150)    NOT NULL UNIQUE,
    phone         VARCHAR(20)     UNIQUE,
    password_hash VARCHAR(255)    NOT NULL,
    role          VARCHAR(10)     NOT NULL CHECK (role IN ('buyer','seller','admin')),
    is_active     BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_email  ON users (email);
CREATE INDEX idx_users_role   ON users (role);
CREATE TABLE buyer_profiles (
    buyer_id        SERIAL          PRIMARY KEY,
    user_id         INT             NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    shipping_address TEXT,
    city            VARCHAR(60),
    country         VARCHAR(60)     NOT NULL DEFAULT 'Pakistan',
    date_of_birth   DATE,
    loyalty_points  INT             NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_buyer_user ON buyer_profiles (user_id);
CREATE TABLE delivery_services (
    delivery_service_id SERIAL        PRIMARY KEY,
    name                VARCHAR(150)  NOT NULL UNIQUE,
    contact_phone       VARCHAR(20),
    contact_email       VARCHAR(150),
    base_rate           NUMERIC(8,2)  NOT NULL CHECK (base_rate >= 0),
    per_kg_rate         NUMERIC(8,2)  NOT NULL CHECK (per_kg_rate >= 0),
    estimated_days_min  SMALLINT      NOT NULL CHECK (estimated_days_min >= 1),
    estimated_days_max  SMALLINT      NOT NULL CHECK (estimated_days_max >= estimated_days_min),
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE TABLE seller_profiles (
    seller_id                     SERIAL          PRIMARY KEY,
    user_id                       INT             NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    preferred_delivery_service_id INT             REFERENCES delivery_services(delivery_service_id) ON DELETE SET NULL,
    shop_name                     VARCHAR(150)    NOT NULL UNIQUE,
    shop_description              TEXT,
    business_address              TEXT,
    city                          VARCHAR(60),
    country                       VARCHAR(60)     NOT NULL DEFAULT 'Pakistan',
    is_verified                   BOOLEAN         NOT NULL DEFAULT FALSE,
    rating                        NUMERIC(3,2)    CHECK (rating BETWEEN 0 AND 5),
    total_sales                   INT             NOT NULL DEFAULT 0 CHECK (total_sales >= 0),
    created_at                    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_seller_user              ON seller_profiles (user_id);
CREATE INDEX idx_seller_shop_name         ON seller_profiles (shop_name);
CREATE INDEX idx_seller_verified          ON seller_profiles (is_verified);
CREATE INDEX idx_seller_pref_delivery     ON seller_profiles (preferred_delivery_service_id);
CREATE TABLE admin_profiles (
    admin_id        SERIAL          PRIMARY KEY,
    user_id         INT             NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    department      VARCHAR(100),
    access_level    SMALLINT        NOT NULL DEFAULT 1 CHECK (access_level BETWEEN 1 AND 3),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE TABLE categories (
    category_id   SERIAL        PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL UNIQUE,
    parent_id     INT           REFERENCES categories(category_id) ON DELETE SET NULL,
    description   TEXT,
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_category_parent ON categories (parent_id);
CREATE TABLE products (
    product_id      SERIAL          PRIMARY KEY,
    seller_id       INT             NOT NULL REFERENCES seller_profiles(seller_id) ON DELETE CASCADE,
    category_id     INT             NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    name            VARCHAR(250)    NOT NULL,
    description     TEXT,
    price           NUMERIC(12,2)   NOT NULL CHECK (price > 0),
    discount_pct    NUMERIC(5,2)    NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    stock_qty       INT             NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    weight_kg       NUMERIC(8,3)    CHECK (weight_kg > 0),
    sku             VARCHAR(100)    UNIQUE,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_products_seller      ON products (seller_id);
CREATE INDEX idx_products_category    ON products (category_id);
CREATE INDEX idx_products_price       ON products (price);
CREATE INDEX idx_products_active      ON products (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_products_name_search ON products USING gin(to_tsvector('english', name));
CREATE TABLE product_images (
    image_id      SERIAL        PRIMARY KEY,
    product_id    INT           NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    image_url     VARCHAR(500)  NOT NULL,
    is_primary    BOOLEAN       NOT NULL DEFAULT FALSE,
    display_order SMALLINT      NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_product_images_product ON product_images (product_id);
CREATE UNIQUE INDEX idx_product_one_primary ON product_images (product_id) WHERE is_primary = TRUE;
CREATE TABLE wallets (
    wallet_id     SERIAL          PRIMARY KEY,
    user_id       INT             NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    balance       NUMERIC(12,2)   NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    currency      VARCHAR(5)      NOT NULL DEFAULT 'PKR',
    is_active     BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wallet_user ON wallets (user_id);
CREATE TABLE orders (
    order_id            SERIAL          PRIMARY KEY,
    buyer_id            INT             NOT NULL REFERENCES buyer_profiles(buyer_id) ON DELETE RESTRICT,
    seller_id           INT             NOT NULL REFERENCES seller_profiles(seller_id) ON DELETE RESTRICT,
    delivery_service_id INT             REFERENCES delivery_services(delivery_service_id) ON DELETE SET NULL,
    status              VARCHAR(20)     NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','confirmed','packed','shipped','delivered','cancelled','refunded')),
    subtotal            NUMERIC(12,2)   NOT NULL CHECK (subtotal >= 0),
    delivery_fee        NUMERIC(8,2)    NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    discount_amount     NUMERIC(8,2)    NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount        NUMERIC(12,2)   NOT NULL CHECK (total_amount >= 0),
    shipping_address    TEXT            NOT NULL,
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_orders_buyer          ON orders (buyer_id);
CREATE INDEX idx_orders_seller         ON orders (seller_id);
CREATE INDEX idx_orders_status         ON orders (status);
CREATE INDEX idx_orders_created        ON orders (created_at DESC);
CREATE INDEX idx_orders_delivery_svc   ON orders (delivery_service_id);
CREATE TABLE order_items (
    order_item_id   SERIAL          PRIMARY KEY,
    order_id        INT             NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id      INT             NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    quantity        INT             NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(12,2)   NOT NULL CHECK (unit_price > 0),
    discount_pct    NUMERIC(5,2)    NOT NULL DEFAULT 0,
    line_total      NUMERIC(12,2)   NOT NULL CHECK (line_total >= 0),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_order_items_order   ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);
CREATE TABLE wallet_transactions (
    txn_id          SERIAL          PRIMARY KEY,
    wallet_id       INT             NOT NULL REFERENCES wallets(wallet_id) ON DELETE RESTRICT,
    order_id        INT             REFERENCES orders(order_id) ON DELETE SET NULL,
    txn_type        VARCHAR(20)     NOT NULL
                        CHECK (txn_type IN ('topup','payment','refund','seller_credit','withdrawal')),
    amount          NUMERIC(12,2)   NOT NULL CHECK (amount > 0),
    balance_before  NUMERIC(12,2)   NOT NULL,
    balance_after   NUMERIC(12,2)   NOT NULL,
    description     TEXT,
    reference_no    VARCHAR(100)    UNIQUE DEFAULT gen_random_uuid()::TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_txn_wallet      ON wallet_transactions (wallet_id);
CREATE INDEX idx_txn_order       ON wallet_transactions (order_id);
CREATE INDEX idx_txn_type        ON wallet_transactions (txn_type);
CREATE INDEX idx_txn_created     ON wallet_transactions (created_at DESC);
CREATE TABLE delivery_tracking (
    tracking_id         SERIAL          PRIMARY KEY,
    order_id            INT             NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    delivery_service_id INT             NOT NULL REFERENCES delivery_services(delivery_service_id),
    tracking_number     VARCHAR(100)    UNIQUE,
    current_status      VARCHAR(30)     NOT NULL DEFAULT 'pickup_scheduled'
                            CHECK (current_status IN ('pickup_scheduled','picked_up','in_transit','out_for_delivery','delivered','failed','returned')),
    current_location    VARCHAR(200),
    estimated_delivery  DATE,
    actual_delivery     TIMESTAMPTZ,
    notes               TEXT,
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tracking_order   ON delivery_tracking (order_id);
CREATE INDEX idx_tracking_number  ON delivery_tracking (tracking_number);
CREATE OR REPLACE VIEW vw_seller_dashboard AS
SELECT
    sp.seller_id,
    sp.shop_name,
    u.email,
    u.phone,
    sp.is_verified,
    sp.rating,
    ds_pref.name                        AS preferred_courier,
    COUNT(DISTINCT o.order_id)          AS total_orders,
    COALESCE(SUM(o.total_amount)
        FILTER (WHERE o.status = 'delivered'), 0)   AS total_revenue,
    COUNT(DISTINCT p.product_id)        AS total_products,
    COALESCE(SUM(p.stock_qty), 0)       AS total_stock_qty,
    w.balance                           AS wallet_balance
FROM seller_profiles sp
JOIN users u                        ON u.user_id   = sp.user_id
LEFT JOIN delivery_services ds_pref ON ds_pref.delivery_service_id = sp.preferred_delivery_service_id
LEFT JOIN products p                ON p.seller_id = sp.seller_id
LEFT JOIN orders o                  ON o.seller_id = sp.seller_id
LEFT JOIN wallets w                 ON w.user_id   = sp.user_id
GROUP BY sp.seller_id, sp.shop_name, u.email, u.phone,
         sp.is_verified, sp.rating, ds_pref.name, w.balance;
CREATE OR REPLACE VIEW vw_buyer_order_history AS
SELECT
    bp.buyer_id,
    u.full_name      AS buyer_name,
    u.email,
    o.order_id,
    o.status         AS order_status,
    o.total_amount,
    o.created_at     AS order_date,
    sp.shop_name     AS seller_name,
    COALESCE(ds_override.name, ds_pref.name) AS delivery_service,
    dt.tracking_number,
    dt.current_status AS delivery_status,
    dt.estimated_delivery
FROM buyer_profiles bp
JOIN users u                            ON u.user_id    = bp.user_id
LEFT JOIN orders o                      ON o.buyer_id   = bp.buyer_id
LEFT JOIN seller_profiles sp            ON sp.seller_id = o.seller_id
LEFT JOIN delivery_services ds_pref     ON ds_pref.delivery_service_id    = sp.preferred_delivery_service_id
LEFT JOIN delivery_services ds_override ON ds_override.delivery_service_id = o.delivery_service_id
LEFT JOIN delivery_tracking dt          ON dt.order_id  = o.order_id;
CREATE OR REPLACE VIEW vw_product_catalogue AS
SELECT
    p.product_id,
    p.name          AS product_name,
    c.name          AS category,
    sp.shop_name    AS seller,
    p.price,
    p.discount_pct,
    ROUND(p.price * (1 - p.discount_pct / 100), 2) AS effective_price,
    p.stock_qty,
    p.weight_kg,
    p.sku,
    p.is_active,
    pi_img.image_url AS primary_image
FROM products p
JOIN categories c              ON c.category_id = p.category_id
JOIN seller_profiles sp        ON sp.seller_id  = p.seller_id
LEFT JOIN product_images pi_img ON pi_img.product_id = p.product_id
                                AND pi_img.is_primary = TRUE;
CREATE OR REPLACE FUNCTION fn_deduct_wallet_on_order()
RETURNS TRIGGER AS $$
DECLARE
    v_wallet_id     INT;
    v_balance_before NUMERIC(12,2);
BEGIN
    IF NEW.status = 'confirmed' AND (OLD IS NULL OR OLD.status <> 'confirmed') THEN
        SELECT wallet_id, balance
          INTO v_wallet_id, v_balance_before
          FROM wallets w
          JOIN buyer_profiles bp ON bp.user_id = w.user_id
         WHERE bp.buyer_id = NEW.buyer_id
           AND w.is_active = TRUE;
        IF v_balance_before < NEW.total_amount THEN
            RAISE EXCEPTION 'Insufficient wallet balance. Required: %, Available: %',
                NEW.total_amount, v_balance_before;
        END IF;
        UPDATE wallets SET balance = balance - NEW.total_amount,
                           updated_at = NOW()
         WHERE wallet_id = v_wallet_id;
        INSERT INTO wallet_transactions
            (wallet_id, order_id, txn_type, amount, balance_before, balance_after, description)
        VALUES
            (v_wallet_id, NEW.order_id, 'payment', NEW.total_amount,
             v_balance_before, v_balance_before - NEW.total_amount,
             'Payment for Order #' || NEW.order_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_deduct_wallet_on_order
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_deduct_wallet_on_order();
CREATE OR REPLACE FUNCTION fn_decrement_stock()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products
       SET stock_qty  = stock_qty - NEW.quantity,
           updated_at = NOW()
     WHERE product_id = NEW.product_id;
    IF (SELECT stock_qty FROM products WHERE product_id = NEW.product_id) < 0 THEN
        RAISE EXCEPTION 'Insufficient stock for product_id = %', NEW.product_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_decrement_stock
AFTER INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION fn_decrement_stock();
CREATE OR REPLACE FUNCTION fn_credit_seller_on_delivery()
RETURNS TRIGGER AS $$
DECLARE
    v_wallet_id      INT;
    v_balance_before NUMERIC(12,2);
    v_credit_amount  NUMERIC(12,2);
BEGIN
    IF NEW.status = 'delivered' AND OLD.status <> 'delivered' THEN
        v_credit_amount := NEW.subtotal - NEW.discount_amount;
        SELECT wallet_id, balance
          INTO v_wallet_id, v_balance_before
          FROM wallets w
          JOIN seller_profiles sp ON sp.user_id = w.user_id
         WHERE sp.seller_id = NEW.seller_id
           AND w.is_active = TRUE;
        UPDATE wallets SET balance = balance + v_credit_amount,
                           updated_at = NOW()
         WHERE wallet_id = v_wallet_id;
        INSERT INTO wallet_transactions
            (wallet_id, order_id, txn_type, amount, balance_before, balance_after, description)
        VALUES
            (v_wallet_id, NEW.order_id, 'seller_credit', v_credit_amount,
             v_balance_before, v_balance_before + v_credit_amount,
             'Credit for delivered Order #' || NEW.order_id);
        UPDATE seller_profiles SET total_sales = total_sales + 1
         WHERE seller_id = NEW.seller_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_credit_seller_on_delivery
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_credit_seller_on_delivery();
CREATE OR REPLACE FUNCTION fn_refund_wallet_on_cancel()
RETURNS TRIGGER AS $$
DECLARE
    v_wallet_id      INT;
    v_balance_before NUMERIC(12,2);
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
       AND OLD.status IN ('confirmed','packed','shipped') THEN

        SELECT wallet_id, balance
          INTO v_wallet_id, v_balance_before
          FROM wallets w
          JOIN buyer_profiles bp ON bp.user_id = w.user_id
         WHERE bp.buyer_id = NEW.buyer_id
           AND w.is_active = TRUE;

        UPDATE wallets SET balance = balance + NEW.total_amount,
                           updated_at = NOW()
         WHERE wallet_id = v_wallet_id;

        INSERT INTO wallet_transactions
            (wallet_id, order_id, txn_type, amount, balance_before, balance_after, description)
        VALUES
            (v_wallet_id, NEW.order_id, 'refund', NEW.total_amount,
             v_balance_before, v_balance_before + NEW.total_amount,
             'Refund for cancelled Order #' || NEW.order_id);
        UPDATE products p
           SET stock_qty  = p.stock_qty + oi.quantity,
               updated_at = NOW()
          FROM order_items oi
         WHERE oi.order_id = NEW.order_id
           AND p.product_id = oi.product_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_refund_wallet_on_cancel
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_refund_wallet_on_cancel();
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_users_updated_at      BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_products_updated_at   BEFORE UPDATE ON products   FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_orders_updated_at     BEFORE UPDATE ON orders     FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_wallets_updated_at    BEFORE UPDATE ON wallets    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_buyer') THEN
        CREATE ROLE app_buyer LOGIN PASSWORD 'buyer_pass_change_me';
    END IF;
END$$;
GRANT SELECT ON products, categories, delivery_services, product_images,
               vw_product_catalogue TO app_buyer;
GRANT SELECT, INSERT ON orders, order_items TO app_buyer;
GRANT SELECT, UPDATE ON wallets TO app_buyer;
GRANT SELECT, INSERT ON wallet_transactions TO app_buyer;
GRANT SELECT ON buyer_profiles TO app_buyer;
GRANT UPDATE (shipping_address, city) ON buyer_profiles TO app_buyer;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_seller') THEN
        CREATE ROLE app_seller LOGIN PASSWORD 'seller_pass_change_me';
    END IF;
END$$;
GRANT SELECT ON categories, delivery_services TO app_seller;
GRANT SELECT, INSERT, UPDATE, DELETE ON products, product_images TO app_seller;
GRANT SELECT ON orders, order_items TO app_seller;
GRANT UPDATE (status) ON orders TO app_seller;
GRANT SELECT ON vw_seller_dashboard TO app_seller;
GRANT SELECT ON wallets, wallet_transactions TO app_seller;
GRANT SELECT, UPDATE ON seller_profiles TO app_seller;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
        CREATE ROLE app_admin LOGIN PASSWORD 'admin_pass_change_me';
    END IF;
END$$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin;
