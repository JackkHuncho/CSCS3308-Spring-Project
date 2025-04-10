CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL, password VARCHAR(100) NOT NULL, pfp BYTEA);

CREATE TABLE users_to_posts(user_id INT NOT NULL, post_id INT NOT NULL);

DROP TABLE IF EXISTS posts;

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  caption VARCHAR(400) NOT NULL,
  duration SMALLINT NOT NULL,
  applelink VARCHAR(255),
  spotLink VARCHAR(255),
  upvotes INT DEFAULT 0
);
