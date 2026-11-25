CREATE TABLE playable_repertoire (
  song_key TEXT PRIMARY KEY,
  artist TEXT NOT NULL,
  song TEXT NOT NULL
);
INSERT INTO playable_repertoire (song_key, artist, song)
SELECT json_extract(value, '$.songKey'), json_extract(value, '$.artist'), json_extract(value, '$.song')
FROM app_state, json_each(app_state.body, '$.repertoire')
WHERE app_state.id = 1;
