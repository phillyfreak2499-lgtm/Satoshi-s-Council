-- Arena callsign moderation. Two columns so a callsign can be hidden without
-- deleting the player or any paper lock, and a one-shot pass that hides the
-- callsigns already on the record that break house rules. Matching runs on a
-- compacted form (lower case, common leetspeak folded, separators stripped)
-- against hashes of the blocked terms, so this file carries no term itself.
-- A hidden player keeps its token and every desk_human_calls row; only the
-- public name changes, to paper-<4 hex of the token's sha256>, widened to 8
-- hex if that label is somehow taken. Nothing here deletes anything.
alter table desk_players add column if not exists hidden_at timestamptz;
alter table desk_players add column if not exists hidden_reason text;

with banned(h, l, kind) as (
  values
    ('066fc7b468bbf62055fe69a4f097de90', 4, 'sub'),
    ('0ade91adf264e00acca80a876187c429', 6, 'sub'),
    ('1d123b3c5603b87fd84e1a48ba0bed6c', 6, 'sub'),
    ('2b5a15d9f8f1dcf9a890692de7d44477', 6, 'sub'),
    ('2d2b0783a2ca0e0df1e60fd7dd24d526', 4, 'whole'),
    ('2ea76074f435b632da8c40fed59333bf', 4, 'whole'),
    ('37eee4e91ccb5208a77c59a84770e13f', 7, 'sub'),
    ('48dccc7b3e977017c2ce6edcd8aea570', 10, 'sub'),
    ('5f10c6fe9a3bb8f328858a7d605cff36', 4, 'whole'),
    ('77bab07014fc7f515066f36c4cff3ea4', 6, 'whole'),
    ('7990139b8697d215f9bc9f4e45830f0c', 4, 'whole'),
    ('848908bf8a95da5c02067fbb8e714f86', 7, 'sub'),
    ('8eec5df1378a629d6a9f8e74457973a8', 4, 'whole'),
    ('9271d6eecedd55fcfa6143a33029d496', 5, 'sub'),
    ('9de075d381e0fa2eef488459a3375192', 5, 'whole'),
    ('a37620bc5641c271668c1cda396eeb6f', 9, 'sub'),
    ('b1860783a249a02405f6988c9e83f65a', 4, 'whole'),
    ('b59f8f3854abf10b87093d912a936377', 5, 'whole'),
    ('ba4058c009bb4dac53ba559640e202d6', 7, 'sub'),
    ('c35312fb3a7e05b7a44db2326bd29040', 6, 'sub'),
    ('c592eff5625d551b0c5be656377ff871', 3, 'whole'),
    ('cb205edee16b24366c871cf55e781346', 6, 'sub'),
    ('cb42e130d1471239a27fca6228094f0e', 3, 'sub'),
    ('ed568ded728bf4d1c56ab349fa4823c3', 4, 'whole'),
    ('f5ab462e064d758a6e082ddb6d991ac0', 5, 'sub'),
    ('f9e06fb9d5ff2500fb76873475d7636d', 6, 'sub')
),
norm as (
  select p.token,
         regexp_replace(translate(lower(p.name), '1!|34@0$57869+', 'iiieaaosstbggt'), '[^a-z0-9]', '', 'g') as s
    from desk_players p
   where p.hidden_at is null
),
hit as (
  select distinct n.token
    from norm n
    join banned b on (b.kind = 'whole' and md5(n.s) = b.h)
                  or (b.kind = 'sub' and length(n.s) >= b.l and exists (
                        select 1 from generate_series(1, length(n.s) - b.l + 1) i where md5(substr(n.s, i, b.l)) = b.h))
),
label as (
  select h.token, encode(sha256(convert_to(h.token, 'UTF8')), 'hex') as hex from hit h
)
update desk_players p
   set name = 'paper-' || case
         when exists (select 1 from desk_players q where q.token <> p.token and lower(q.name) = 'paper-' || left(l.hex, 4)) then left(l.hex, 8)
         else left(l.hex, 4) end,
       hidden_at = now(),
       hidden_reason = 'policy'
  from label l
 where p.token = l.token and p.hidden_at is null;
