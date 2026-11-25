-- Bound in-flight webhook delivery checks in dispatchAt and beginDelivery without scanning historical rows.
CREATE INDEX CONCURRENTLY deliveries_sending ON webhook_deliveries (org_id, board_id, webhook, lease_until) WHERE state = 'sending';
