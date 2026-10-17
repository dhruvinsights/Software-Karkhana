-- 036_station_channels.sql
-- A channel can belong to one station (developer, qa, ...) of a project, so each
-- team space has its own conversations. Its audience is the station's team, the
-- whole project, or (visibility 'public') linked to the entire workspace.

ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS station text;
CREATE INDEX IF NOT EXISTS chat_channels_project_station_idx ON chat_channels (project_id, station);
