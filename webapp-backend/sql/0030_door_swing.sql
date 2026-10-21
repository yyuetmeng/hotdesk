-- Door swing setting (owner request 2026-10-21): which way a door opens and which end its hinge is on, chosen per
-- door in the floor plan editor and drawn on the floor. Existing doors keep the old drawing: opens up, hinge left.
update floor_elements set config = config || '{"swing": "up-left"}'::jsonb
 where type = 'door' and not (config ? 'swing');
