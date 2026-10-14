-- Element type 'kitchen' was renamed to 'pantry'.
update floor_plan_elements set type = 'pantry' where type = 'kitchen';
