alter table board add column if not exists kind text not null default 'idea';
alter table board add column if not exists parent_id integer;
create index if not exists board_parent_idx on board (parent_id);
