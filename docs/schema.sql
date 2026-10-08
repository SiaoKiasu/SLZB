-- Optional: run manually before deployment if the app role cannot CREATE TABLE.
CREATE TABLE IF NOT EXISTS slzb_snapshots (
  account_id TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  observed_at BIGINT NOT NULL,
  equity NUMERIC(38, 12) NOT NULL,
  PRIMARY KEY (account_id, bucket)
);
