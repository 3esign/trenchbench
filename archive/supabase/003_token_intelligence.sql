-- supabase/003_token_intelligence.sql
-- Database structures for the TrenchBench Token Intelligence Harness (TIH)

CREATE TABLE IF NOT EXISTS recorded_tokens (
    address VARCHAR(44) PRIMARY KEY,
    symbol VARCHAR(16) NOT NULL,
    name VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    launch_price NUMERIC NOT NULL,
    virtual_sol_reserves NUMERIC DEFAULT 30.0,
    virtual_token_reserves NUMERIC DEFAULT 1073000000.0,
    graduated BOOLEAN DEFAULT FALSE,
    graduation_timestamp TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS token_historical_ticks (
    id BIGSERIAL PRIMARY KEY,
    token_address VARCHAR(44) REFERENCES recorded_tokens(address) ON DELETE CASCADE,
    tick_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    price_native NUMERIC NOT NULL,
    volume_5m NUMERIC DEFAULT 0,
    liquidity_usd NUMERIC DEFAULT 0,
    market_cap NUMERIC DEFAULT 0
);
