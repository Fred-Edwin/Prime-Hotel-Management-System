-- Client's real canteen catalog (hotel-menu-items.json / canteen-items.json)
-- has categories the item_category enum didn't cover: Stationeries, Dawa
-- (medicine), Sweets, Biscuits, Packing Supplies, and a general Others
-- bucket. Adding them as real enum values rather than collapsing into
-- 'retail', per explicit client/user decision during Phase 8 seeding.
--
-- Postgres requires each `alter type ... add value` in its own
-- transaction-committing statement, so this migration is exactly that
-- and nothing else.

alter type item_category add value 'stationery';
alter type item_category add value 'dawa';
alter type item_category add value 'sweets';
alter type item_category add value 'biscuits';
alter type item_category add value 'packing_supplies';
alter type item_category add value 'others';
