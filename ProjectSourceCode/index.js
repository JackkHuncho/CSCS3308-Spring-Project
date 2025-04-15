// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express');
const app = express();
const handlebars = require('express-handlebars');
const path = require('path');
const pgp = require('pg-promise')();
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const multer = require('multer');
const fetch = require('node-fetch');
require('dotenv').config();

// *****************************************************
// <!-- Section 1.5 : Connect to API Additions -->
// *****************************************************

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  saveUninitialized: false,
  resave: false,
}));

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, 'src', 'views', 'layouts'),
  partialsDir: path.join(__dirname, 'src', 'views', 'partials'),
  helpers: {
    convertToEmbed: (url) => {
      const spotifyMatch = url.match(/playlist\/([^?]+)/);
      const appleMatch = url.match(/apple\.com\/.+\/playlist\/.+\/(pl\..+?)(\?|$)/);
  
      if (url.includes('spotify') && spotifyMatch) {
        const id = spotifyMatch[1];
        return `https://open.spotify.com/embed/playlist/${id}?utm_source=generator`;
      } else if (url.includes('apple') && appleMatch) {
        const id = appleMatch[1];
        return `https://embed.music.apple.com/us/playlist/${id}`;
      } else {
        return '';
      }
    }
  }
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
app.use('/img', express.static(path.join(__dirname, 'src', 'resources', 'img')));


app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/css', express.static(path.join(__dirname, 'src/resources/css')));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

const upload = multer();

const auth = (req, res, next) => {
  const openRoutes = ['/login', '/register', '/home', '/welcome'];
  if (!req.session.user && !openRoutes.includes(req.path)) {
    return res.redirect('/login');
  }

  if (req.session.user) {
    req.session.user.spotify_connected = !!req.session.spotifyAccessToken;
    req.session.user.apple_connected = !!req.session.appleUserToken;
  }

  res.locals.user = req.session.user;
  next();
};

app.use(auth);

// *****************************************************
// <!-- Section 5 : API Routes -->
// *****************************************************

// --- Apple Developer Token Route (static)
app.get('/apple-token', (req, res) => {
  const developerToken = process.env.APPLE_MUSIC_DEV_TOKEN;
  res.json({ token: developerToken });
});

// --- Apple User Token Capture
app.post('/apple-user-token', (req, res) => {
  const { userToken } = req.body;
  req.session.appleUserToken = userToken;
  req.session.user = {
    ...req.session.user,
    apple_connected: true
  };
  res.json({ message: 'Apple Music token stored' });
});

// --- Spotify Auth Redirect
app.get('/connect-spotify', (req, res) => {
  const { SPOTIFY_CLIENT_ID } = process.env;
  const redirectUri = 'http://localhost:3000/spotify-callback?from=settings';
  const scope = 'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public';


  const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
  })}`;

  res.redirect(authUrl);
});

app.get('/spotify-callback', async (req, res) => {
  const code = req.query.code;
  const redirectBack = req.query.from === 'settings' ? '/settings' : '/home';

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
        redirect_uri: 'http://localhost:3000/spotify-callback?from=settings'
      })
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    req.session.spotifyAccessToken = accessToken;
    req.session.user = {
      ...req.session.user,
      spotify_connected: true
    };

    res.redirect('/settings?spotify=connected');
  } catch (error) {
    console.error('Spotify callback error:', error);
    res.status(500).send('Spotify authentication failed');
  }
});
// =================== GET ROUTES ===================

app.get('/welcome', (req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('pages/login', { pageTitle: 'Login' }));

app.get('/register', (req, res) => res.render('pages/register'));

app.get('/home', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const posts = await db.any('SELECT * FROM posts ORDER BY id DESC');
    res.render('pages/home', {
      user: req.session.user,
      posts: posts
    });
  } catch (err) {
    console.error('Error loading posts:', err);
    res.render('pages/home', {
      user: req.session.user,
      message: 'Error loading playlists',
      posts: []
    });
  }
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

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (user) {
      return res.status(409).render('pages/register', { message: 'Username Already Taken' });
    }
    const hash = await bcrypt.hash(password, 10);
    const defaultImagePath = path.join(__dirname, 'src', 'resources', 'img', 'Defaultpfp.png');
    const defaultImage = fs.readFileSync(defaultImagePath);

    await db.none('INSERT INTO users (username, password, pfp) VALUES ($1, $2, $3)', [username, hash, defaultImage]);

    return res.status(200).redirect('/login')
  } catch (err) {
    console.error('Registration Error:', err);
    return res.status(409).render('pages/register', { message: 'Registration failed. Try again.' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return res.status(401).render('pages/login', { message: 'Incorrect Username or Password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).render('pages/login', { message: 'Incorrect Username or Password.' });
    }

    user.pfp = `/pfp/${user.username}`;
    req.session.user = user;
    req.session.save(() => res.status(200).redirect('/home'));
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).render('pages/login', { message: 'Server Error. Try again later.' });
  }
});

app.post('/loginTest', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return res.status(401).json({ message: 'Incorrect Username or Password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Incorrect Username or Password.' });
    }

    delete user.password;
    req.session.user = user;

    req.session.save(() => {
      res.status(200).json({ message: 'Login Successful.' });
    });

  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ message: 'Server Error. Try again later.' });
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

    const updatedUser = await db.one(
      `UPDATE users 
       SET username = $1, password = $2, pfp = $3 
       WHERE id = $4 
       RETURNING *`,
      [username, passwordToSave, pfpBuffer, req.session.user.id]
    );

    updatedUser.pfp = `/pfp/${updatedUser.username}`;
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

// =================== POST /posts ===================

app.post('/posts', async (req, res) => {
  const { title, caption, applelink, spotLink } = req.body;

  if (!applelink && !spotLink) {
    return res.status(400).json({ success: false, message: 'Please provide at least one link.' });
  }

  try {
    const duration = 0;
    const username = req.session.user.username;
    const pfp = req.session.user.pfp;

    const post = await db.one(
      `INSERT INTO posts (title, caption, duration, applelink, spotLink, upvotes, username, pfp)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
       RETURNING *`,
      [title, caption, duration, applelink || null, spotLink || null, username, pfp]
    );

    res.json({ success: true, post });
  } catch (err) {
    console.error('Post creation error:', err);
    res.status(500).json({ success: false, message: 'Database error while creating post.' });
  }
});

// This is the Conversion stuff

app.post('/convert-playlist', async (req, res) => {
  try {
    // 1. Check if user is logged in:
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    }

    // 2. Pull relevant data from request body or session:
    const { link } = req.body;
    // If you prefer, you can also pass link in query params or however you like.

    if (!link) {
      return res.status(400).json({ error: 'No playlist link provided.' });
    }

    // We'll rely on session-based tokens:
    const spotifyAccessToken = req.session.spotifyAccessToken;
    const appleMusicDeveloperToken = process.env.APPLE_MUSIC_DEV_TOKEN; // from .env
    const appleMusicUserToken = req.session.appleUserToken;
    const storefront = 'us'; // Hard-code or detect user’s region

    // 3. Determine if link is for Spotify or Apple Music
    const isSpotifyLink = link.includes('spotify.com');
    const isAppleLink = link.includes('music.apple.com');

    if (!isSpotifyLink && !isAppleLink) {
      return res.status(400).json({
        error: 'Unsupported link. Must be a Spotify or Apple Music playlist URL.',
      });
    }

    // 4. Do the conversion based on link type
    let newPlaylistId;
    if (isSpotifyLink) {
      // =============== SPOTIFY → APPLE MUSIC ===============

      // Ensure we have Spotify & Apple tokens
      if (!spotifyAccessToken || !appleMusicDeveloperToken || !appleMusicUserToken) {
        return res
          .status(400)
          .json({ error: 'Missing required Spotify or Apple Music tokens.' });
      }

      const spotifyPlaylistId = extractSpotifyPlaylistId(link);
      if (!spotifyPlaylistId) {
        return res
          .status(400)
          .json({ error: 'Could not parse Spotify playlist ID from link.' });
      }

      // 1) Fetch tracks from Spotify
      const spotifyTracks = await fetchSpotifyPlaylistTracks(
        spotifyPlaylistId
      );

      // 2) Create a new Apple Music playlist in user’s library
      newPlaylistId = await createAppleMusicPlaylist(
        appleMusicDeveloperToken,
        appleMusicUserToken
      );

      // 3) For each Spotify track, search Apple Music & add the match
      for (const track of spotifyTracks) {
        const appleSongId = await searchAppleMusicSongId(
          track,
          storefront,
          appleMusicDeveloperToken,
          appleMusicUserToken
        );
        if (appleSongId) {
          await addSongToAppleMusicPlaylist(
            newPlaylistId,
            appleSongId,
            appleMusicDeveloperToken,
            appleMusicUserToken
          );
        }
      }
    } else {
      // =============== APPLE MUSIC → SPOTIFY ===============

      // Ensure we have Spotify & Apple tokens
      if (!spotifyAccessToken || !appleMusicDeveloperToken || !appleMusicUserToken) {
        return res
          .status(400)
          .json({ error: 'Missing required Spotify or Apple Music tokens.' });
      }

      const applePlaylistId = extractAppleMusicPlaylistId(link);
      if (!applePlaylistId) {
        return res
          .status(400)
          .json({ error: 'Could not parse Apple Music playlist ID from link.' });
      }

      // 1) Fetch tracks from Apple Music
      const appleTracks = await fetchAppleMusicPlaylistTracks(
        applePlaylistId,
        appleMusicDeveloperToken,
        appleMusicUserToken,
        storefront
      );

      // 2) Create a new Spotify playlist
      newPlaylistId = await createSpotifyPlaylist(spotifyAccessToken);

      // 3) For each Apple track, search Spotify & add the match
      for (const track of appleTracks) {
        const spotifyTrackUri = await searchSpotifyTrackUri(track, spotifyAccessToken);
        if (spotifyTrackUri) {
          await addTrackToSpotifyPlaylist(newPlaylistId, spotifyTrackUri, spotifyAccessToken);
        }
      }
    }

    // 5. Return the ID of the newly created playlist on the destination platform
    res.status(200).json({
      message: 'Playlist conversion completed!',
      newPlaylistId,
    });
  } catch (error) {
    console.error('Error in /convert-playlist:', error);
    res.status(500).json({ error: error.message });
  }
});

// =================== HELPER FUNCTIONS ===================

// Simple ID extractor for Spotify links
function extractSpotifyPlaylistId(spotifyLink) {
  // e.g. https://open.spotify.com/playlist/3lGRRZtycaH21D8L9HYy7U?si=...
  const regex = /playlist\/([a-zA-Z0-9]+)/;
  const match = spotifyLink.match(regex);
  return match ? match[1] : null;
}

// Simple ID extractor for Apple Music links
function extractAppleMusicPlaylistId(appleLink) {
  // e.g. https://music.apple.com/us/playlist/ambient/pl.u-xxxx
  // This can vary if it's a public Apple Music playlist vs a user’s library playlist
  const regex = /playlist\/([^/]+)/;
  const match = appleLink.match(regex);
  return match ? match[1] : null;
}

// to allow spotify to grab playlists with client isntead of user - kendrix
async function getSpotifyClientCredentialsToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });
  const data = await resp.json();
  return data.access_token;  // no user login needed
}


// =================== Spotify Helpers ===================

// 1) Fetch all tracks from a Spotify playlist
// Fetch tracks from a PUBLIC Spotify playlist using client credentials
async function fetchSpotifyPlaylistTracks(playlistId) {
  // 1) Get a client credentials token
  const token = await getSpotifyClientCredentialsToken();

  // 2) Call Spotify’s GET /v1/playlists/{playlist_id}/tracks
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  console.log('Fetching public playlist URL:', url);

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const status = resp.status;
  let responseData;
  try {
    responseData = await resp.json();
  } catch (err) {
    console.error('Failed to parse response body:', err);
  }

  console.log('Spotify response status:', status);
  console.log('Spotify response body:', responseData);

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Spotify playlist ${playlistId}: ${status} ${
        responseData?.error?.message || JSON.stringify(responseData)
      }`
    );
  }

  // If successful, parse tracks from responseData
  // Typically, responseData.items is an array of track objects
  // For example: { items: [ { track: { name, artists[], album } }, ... ] }
  return (responseData.items || [])
    .filter((item) => item.track)
    .map((item) => ({
      title: item.track.name,
      artist: item.track.artists?.[0]?.name || '',
      album: item.track.album?.name || '',
    }));
}



// 2) Create a new Spotify playlist (in authorized user’s account)
async function createSpotifyPlaylist(accessToken) {
  // We use /v1/me/playlists
  const url = 'https://api.spotify.com/v1/me/playlists';
  const body = {
    name: 'Converted from Apple Music',
    public: false,
    description: 'Auto-created by our conversion tool',
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error('Failed to create a Spotify playlist');
  }
  const data = await resp.json();
  return data.id; // newly created playlist ID
}

// 3) Search for a track on Spotify, return its Spotify URI
async function searchSpotifyTrackUri(track, accessToken) {
  // track = { title, artist, album }
  const q = encodeURIComponent(`${track.title} ${track.artist}`);
  const url = `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    console.warn(`Spotify search failed for "${track.title}"`);
    return null;
  }
  const data = await resp.json();
  const firstTrack = data.tracks?.items?.[0];
  return firstTrack ? firstTrack.uri : null; // e.g. "spotify:track:1234"
}

// 4) Add a track to a Spotify playlist
async function addTrackToSpotifyPlaylist(playlistId, trackUri, accessToken) {
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  const body = { uris: [trackUri] };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.warn(`Failed to add track ${trackUri} to Spotify playlist ${playlistId}`);
  }
}

// =================== Apple Music Helpers ===================

// 1) Create a new Apple Music playlist in the user’s library
async function createAppleMusicPlaylist(devToken, userToken) {
  const url = 'https://api.music.apple.com/v1/me/library/playlists';

  // kendrix - here we can change the name to match the name they have under their post.
  const body = {
    attributes: {
      name: 'Converted from Spotify',
      description: 'Auto-created by our conversion tool',
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${devToken}`,
      'Music-User-Token': userToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error('Failed to create Apple Music playlist');
  }

  const data = await resp.json();
  // data.data: [{ id: 'p.<some_id>', attributes: {...} }]
  return data.data?.[0]?.id;
}

// 2) Fetch tracks from Apple Music playlist
async function fetchAppleMusicPlaylistTracks(playlistId, devToken, userToken, storefront) {
  // If this is a user’s library playlist:
  // GET /v1/me/library/playlists/{id}/tracks
  // If it’s a public Apple Music "catalog" playlist, you might need:
  // GET /v1/catalog/{storefront}/playlists/{id}
  // We'll assume it’s from the user's library for simplicity:
  const url = `https://api.music.apple.com/v1/me/library/playlists/${playlistId}/tracks`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${devToken}`,
      'Music-User-Token': userToken,
    },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch Apple Music playlist ${playlistId}`);
  }
  const data = await resp.json();
  // data.data: [ { attributes: { name, artistName, albumName }}, ... ]
  return (data.data || []).map((item) => ({
    title: item.attributes?.name || '',
    artist: item.attributes?.artistName || '',
    album: item.attributes?.albumName || '',
  }));
}

// 3) Search Apple Music for a track, return the matched Apple Music song ID
async function searchAppleMusicSongId(track, storefront, devToken, userToken) {
  const term = encodeURIComponent(`${track.title} ${track.artist}`);
  const url = `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${term}&types=songs&limit=1`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${devToken}`,
      'Music-User-Token': userToken,
    },
  });

  if (!resp.ok) {
    console.warn(`Apple Music search failed for "${track.title}"`);
    return null;
  }

  const data = await resp.json();
  const foundSong = data.results?.songs?.data?.[0];
  return foundSong ? foundSong.id : null;
}

// 4) Add a song to an Apple Music playlist
async function addSongToAppleMusicPlaylist(
  playlistId,
  songId,
  devToken,
  userToken
) {
  // POST /v1/me/library/playlists/{id}/tracks
  const url = `https://api.music.apple.com/v1/me/library/playlists/${playlistId}/tracks`;
  const body = {
    data: [{ id: songId, type: 'songs' }],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${devToken}`,
      'Music-User-Token': userToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.warn(`Failed to add song ${songId} to Apple Music playlist ${playlistId}`);
  }
}


// *****************************************************
// <!-- Section 7 : Start Server -->
// *****************************************************

module.exports = app.listen(3000, () => console.log('Server is listening on port 3000'));
