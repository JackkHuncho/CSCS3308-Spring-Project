// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars');
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object
const bcrypt = require('bcryptjs'); // To hash passwords
const fs = require('fs'); // for reading files like images
const multer = require('multer'); // Kendrix - added multer to simplify file parsing

// *****************************************************
// <!-- Apple Dependencies Import -->
require('dotenv').config();
const fetch = require('node-fetch');
// ******************************************************

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, 'src', 'views', 'layouts'),
  partialsDir: path.join(__dirname, 'src', 'views', 'partials'),
});

const dbConfig = {
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};

const db = pgp(dbConfig);

db.connect()
  .then(obj => {
    console.log('Database connection successful');
    obj.done();
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/css', express.static(path.join(__dirname, 'src/resources/css')));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

const upload = multer(); // Kendrix - multer handles multipart/form-data file uploads

const auth = (req, res, next) => {
  const openRoutes = [
    '/login',
    '/register',
    '/home',
    '/connect-spotify',
    '/spotify-callback',
    '/apple-token',
    '/apple-user-token'
  ];
  if (!req.session.user && !openRoutes.includes(req.path)) {
    return res.redirect('/login');
  }
  res.locals.user = req.session.user;
  next();
};
app.use(auth);

// *****************************************************
// <!-- Section 5 : API Routes -->
// *****************************************************

//kendrix - lets try and keep routes organized by post, get, etc...

// =================== GET ROUTES ===================
  // ----------- API SPOTIFY AND APPLE GET ROUTES
  app.get('/apple-token', (req, res) => {
    const developerToken = process.env.APPLE_MUSIC_DEV_TOKEN;
    res.json({ token: developerToken });
  });

  app.get('/connect-spotify', (req, res) => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const redirectUri = 'http://localhost:3000/spotify-callback';
    const scope = 'playlist-read-private playlist-read-collaborative';
  
    const authURL = `https://accounts.spotify.com/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope
      });
  
    res.redirect(authURL);
  });

  app.get('/spotify-callback', async (req, res) => {
    const code = req.query.code;
  
    try {
      const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'http://localhost:3000/spotify-callback'
        })
      });
  
      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
  
      // Fetch Spotify user info (optional)
      const userResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
  
      const userInfo = await userResponse.json();
      console.log('Spotify User Info:', userInfo);
  
      req.session.spotifyAccessToken = accessToken;
      req.session.successMessage = 'Successfully connected to Spotify!';
      res.redirect('/home');
    } catch (error) {
      console.error('Error during Spotify callback:', error);
      res.status(500).send('Spotify authentication failed');
    }
  });  
  

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('pages/login', { pageTitle: 'Login' }));

app.get('/register', (req, res) => res.render('pages/register'));

app.get('/home', (req, res) => {
  const message = req.session.successMessage;
  delete req.session.successMessage;

  res.render('pages/home', { message });
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout Error:', err);
      return res.render('pages/home', { message: 'Error logging out. Please try again.' });
    }
    res.render('pages/login', { message: 'Logged out successfully!' });
  });
});

app.get('/settings', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('pages/settings', { user: req.session.user });
});

app.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('pages/profile', { user: req.session.user });
});

app.get('/pfp/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const user = await db.oneOrNone('SELECT pfp FROM users WHERE username = $1', [username]);

    if (!user || !user.pfp) {
      return res.status(404).send('No Profile Picture Found');
    }

    res.set('Content-Type', 'image/png');
    res.send(user.pfp);

    console.log('Serving PFP for:', username, '| Size:', user.pfp.length);
  } catch (err) {
    console.error('Error retrieving image:', err);
    res.status(500).send('Error retrieving image');
  }
});

// =================== POST ROUTES ===================

  // ----------- API SPOTIFY AND APPLE POST ROUTES
  app.post('/apple-user-token', (req, res) => {
    const { userToken } = req.body;
    req.session.appleUserToken = userToken;
    res.json({ message: 'Apple Music token stored' });
  });

  app.post('/upload-spotify', async (req, res) => {
    const { spotifyLink } = req.body;
    const token = req.session.spotifyAccessToken;
  
    if (!token) {
      return res.render('pages/home', { message: 'You must connect to Spotify first.' });
    }
  
    const match = spotifyLink.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!match) {
      return res.render('pages/home', { message: 'Invalid Spotify playlist link.' });
    }
  
    const playlistId = match[1];
  
    try {
      // Fetch playlist data
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const playlist = await response.json();
  
      // Insert playlist into DB
      const userId = req.session.user.id;
      const newPlaylist = await db.one(
        `INSERT INTO playlists (name, description, user_id, image_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [playlist.name, playlist.description || '', userId, playlist.images?.[0]?.url || null]
      );
  
      // Insert songs
      for (const item of playlist.tracks.items) {
        const track = item.track;
        const isrc = track.external_ids?.isrc;
  
        if (!isrc) continue;
  
        await db.none(
          `INSERT INTO songs (isrc, title, artist, playlist_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (isrc) DO NOTHING`,
          [isrc, track.name, track.artists[0].name, newPlaylist.id]
        );
      }
  
      return res.render('pages/home', {
        message: `Successfully uploaded Spotify playlist: ${playlist.name}`,
        playlist
      });
    } catch (err) {
      console.error('Spotify Upload Error:', err);
      return res.render('pages/home', { message: 'Failed to upload Spotify playlist.' });
    }
  });
  

  app.post('/upload-apple', async (req, res) => {
    const { appleLink } = req.body;
    const userToken = req.session.appleUserToken;
    const developerToken = process.env.APPLE_MUSIC_DEV_TOKEN;
  
    if (!userToken) {
      return res.render('pages/home', { message: 'You must connect to Apple Music first.' });
    }
  
    const match = appleLink.match(/(pl\.[\w-]+)/);
    if (!match) {
      return res.render('pages/home', { message: 'Invalid Apple Music playlist link.' });
    }
  
    const playlistId = match[1];
  
    try {
      const response = await fetch(`https://api.music.apple.com/v1/catalog/us/playlists/${playlistId}`, {
        headers: {
          Authorization: `Bearer ${developerToken}`,
          'Music-User-Token': userToken
        }
      });
  
      const data = await response.json();
      const playlist = data.data[0];
      const attributes = playlist.attributes;
  
      // Insert playlist into DB
      const userId = req.session.user.id;
      const newPlaylist = await db.one(
        `INSERT INTO playlists (name, description, user_id, image_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [attributes.name, attributes.description?.standard || '', userId, attributes.artwork?.url || null]
      );
  
      // Fetch playlist tracks
      const songsUrl = `https://api.music.apple.com${playlist.relationships.tracks.href}`;
const songsResponse = await fetch(songsUrl, {
        headers: {
          Authorization: `Bearer ${developerToken}`,
          'Music-User-Token': userToken
        }
      });
  
      const songsData = await songsResponse.json();
  
      for (const song of songsData.data) {
        const isrc = song.attributes.isrc;
  
        if (!isrc) continue;
  
        await db.none(
          `INSERT INTO songs (isrc, title, artist, playlist_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (isrc) DO NOTHING`,
          [isrc, song.attributes.name, song.attributes.artistName, newPlaylist.id]
        );
      }
  
      return res.render('pages/home', {
        message: `Successfully uploaded Apple Music playlist: ${attributes.name}`,
        playlist: attributes
      });
    } catch (err) {
      console.error('Apple Upload Error:', err);
      return res.render('pages/home', { message: 'Failed to upload Apple Music playlist.' });
    }
  });
  

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (user) {
      return res.render('pages/register', { message: 'Username Already Taken' });
    }

    const hash = await bcrypt.hash(password, 10);
    const defaultImagePath = path.join(__dirname, 'src', 'resources', 'img', 'Defaultpfp.png');
    const defaultImage = fs.readFileSync(defaultImagePath);

    await db.none(
      'INSERT INTO users (username, password, pfp) VALUES ($1, $2, $3)',
      [username, hash, defaultImage]
    );

    return res.redirect('/login');
  } catch (err) {
    console.error('Registration Error:', err);
    return res.render('pages/register', { message: 'Registration failed. Try again.' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return res.render('pages/login', { message: 'Incorrect Username or Password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('pages/login', { message: 'Incorrect Username or Password.' });
    }

    user.pfp = `/pfp/${user.username}`; // Kendrix - serve image from dynamic route
    req.session.user = user;
    req.session.save(() => res.redirect('/home'));
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).render('pages/login', { message: 'Server Error. Try again later.' });
  }
});

app.post('/settings', upload.single('pfp'), async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const username = req.body.username || req.session.user.username;
    const newPassword = req.body.password;
    const pfpBuffer = req.file ? req.file.buffer : req.session.user.pfp;

    let passwordToSave;
    if (newPassword) {
      passwordToSave = await bcrypt.hash(newPassword, 10);
    } else {
      passwordToSave = req.session.user.password;
    }

    // Update user in DB
    const updatedUser = await db.one(
      `UPDATE users 
       SET username = $1, password = $2, pfp = $3 
       WHERE id = $4 
       RETURNING *`,
      [username, passwordToSave, pfpBuffer, req.session.user.id]
    );

    // Update session with fresh values
    updatedUser.pfp = `/pfp/${updatedUser.username}`; // Kendrix - convert buffer to image URL again
    req.session.user = updatedUser;

    res.render('pages/settings', {
      user: req.session.user,
      message: 'Settings updated successfully!',
    });
  } catch (err) {
    console.error('Settings Update Error:', err);
    res.render('pages/settings', {
      user: req.session.user,
      message: 'Error updating settings. Try again.',
    });
  }
});

app.get('/welcome', (req, res) => {
  res.json({status: 'success', message: 'Welcome!'});
});

// *****************************************************
// <!-- Section 7 : Start Server -->
// *****************************************************

module.exports = app.listen(3000, () => console.log('Server is listening on port 3000'));
