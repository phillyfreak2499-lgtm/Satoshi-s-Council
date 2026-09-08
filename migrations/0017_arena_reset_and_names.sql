-- One-time reset of the test locks made while the room was being built,
-- then two rules that make callsign-hopping pointless: one callsign per
-- name (case-insensitive), and a hashed network id on each callsign so new
-- ones can be capped per day. No raw addresses are stored.
delete from desk_human_calls;
delete from desk_players;
alter table desk_players add column if not exists net_hash text;
create unique index if not exists desk_players_name_key on desk_players (lower(name));
create index if not exists desk_players_net_idx on desk_players (net_hash, created_at);
