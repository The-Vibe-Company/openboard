ALTER TABLE webhook_deliveries ALTER COLUMN event DROP NOT NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN thread DROP NOT NULL;
ALTER TABLE webhook_deliveries ADD COLUMN type TEXT NOT NULL DEFAULT 'board.event';
