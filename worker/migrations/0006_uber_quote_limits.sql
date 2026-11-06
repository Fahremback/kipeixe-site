CREATE TABLE IF NOT EXISTS uber_quote_limits (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip,window_start)
);
