-- Disable poll alert by default (poll expiry notifications not implemented)
UPDATE web_push_subscriptions SET alert_poll = 0 WHERE alert_poll = 1;
