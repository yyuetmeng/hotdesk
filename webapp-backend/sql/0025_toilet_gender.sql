-- Toilet gender setting (owner request 2026-10-16): All-gender (default) / Male / Female, chosen per toilet
-- in the floor plan editor and drawn as an icon. Existing toilets read as all-gender.
update floor_elements set config = config || '{"gender": "unisex"}'::jsonb
 where type = 'toilet' and not (config ? 'gender');
