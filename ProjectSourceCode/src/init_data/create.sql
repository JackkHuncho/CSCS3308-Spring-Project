CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL, password VARCHAR(100) NOT NULL, pfp BYTEA);

CREATE TABLE users_to_posts(user_id INT NOT NULL, post_id INT NOT NULL);

CREATE TABLE posts(
    id SERIAL PRIMARY KEY, 
    description VARCHAR(400) NOT NULL, 
    duration SMALLINT NOT NULL, 
    applelink VARCHAR(100) NOT NULL, 
    spotLink VARCHAR(100) NOT NULL, 
    upvotes INT
);

CREATE TABLE playlists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE songs (
  isrc TEXT PRIMARY KEY,  -- Example: "USUM72017254"
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE
);