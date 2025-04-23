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
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, 'src', 'views', 'layouts'),
  partialsDir: path.join(__dirname, 'src', 'views', 'partials'),
  helpers: {
    convertToEmbed: (url) => {
      if (!url) return '';
      const spotifyMatch = url.match(/playlist\/([^?]+)/);
      const appleMatch = url.match(/apple\.com\/.+\/playlist\/.+\/(pl\..+?)(\?|$)/);

      if (url.includes('spotify') && spotifyMatch) {
        return `https://open.spotify.com/embed/playlist/${spotifyMatch[1]}?utm_source=generator`;
      } else if (url.includes('apple') && appleMatch) {
        return `https://embed.music.apple.com/us/playlist/${appleMatch[1]}`;
      }

      return '';
    },

    or: (a, b) => a || b
  }
});




const dbConfig = {
  host: process.env.DATABASE_URL,
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};

const db = pgp(dbConfig);

db.connect()
  .then((obj) => {
    console.log('Database connection successful');
    obj.done();
  })
  .catch((error) => {
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

app.use((req, res, next) => {
  const now = Date.now();
  // TESTING QUICK ExpiRE
  // const expiry = 30 * 1000;
  // NORMAL EXPIRE
  const expiry = 30 * 60 * 1000;

  const spotifyExpired = req.session.spotifyAccessTokenIssuedAt &&
    now - req.session.spotifyAccessTokenIssuedAt > expiry;

  const appleExpired = req.session.appleUserTokenIssuedAt &&
    now - req.session.appleUserTokenIssuedAt > expiry;

  if (spotifyExpired) {
    delete req.session.spotifyAccessToken;
    delete req.session.spotifyAccessTokenIssuedAt;
  }

  if (appleExpired) {
    delete req.session.appleUserToken;
    delete req.session.appleUserTokenIssuedAt;
  }

  // Make flags available to all templates
  res.locals.spotifyExpired = spotifyExpired;
  res.locals.appleExpired = appleExpired;

  if (req.session.user) {
    req.session.user.spotify_connected = !!req.session.spotifyAccessToken;
    req.session.user.apple_connected = !!req.session.appleUserToken;
  }

  next();
});



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
  // added date/time stamp to auth flow
  req.session.appleUserTokenIssuedAt = Date.now();
  req.session.user = {
    ...req.session.user,
    apple_connected: true,
  };
  res.json({ message: 'Apple Music token stored' });
});

// --- Spotify Auth Redirect
app.get('/connect-spotify', (req, res) => {
  const { SPOTIFY_CLIENT_ID } = process.env;
  //const redirectUri = 'http://localhost:3000/spotify-callback?from=settings';
  const redirectUri = 'http://crosstune.onrender.com/spotify-callback?from=settings';
  const scope =
    'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public';

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
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        //redirect_uri: 'http://localhost:3000/spotify-callback?from=settings',
        redirect_uri: 'http://crosstune.onrender.com/spotify-callback?from=settings',
      }),
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    req.session.spotifyAccessToken = accessToken;
    // added date/time stamp to auth flow
    req.session.spotifyAccessTokenIssuedAt = Date.now();
    req.session.user = {
      ...req.session.user,
      spotify_connected: true,
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
      posts: posts,
    });
  } catch (err) {
    console.error('Error loading posts:', err);
    res.render('pages/home', {
      user: req.session.user,
      message: 'Error loading playlists',
      posts: [],
    });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout Error:', err);
      return res.render('pages/home', {
        message: 'Error logging out. Please try again.',
      });
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

app.get('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const posts = await db.any(
      'SELECT * FROM posts WHERE username = $1 ORDER BY id DESC',
      [req.session.user.username]
    );

    res.render('pages/profile', {
      user: req.session.user,
      posts: posts
    });
  } catch (err) {
    console.error('Error loading profile posts:', err);
    res.render('pages/profile', {
      user: req.session.user,
      posts: [],
      message: 'Error loading posts'
    });
  }
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

// user-profile route
app.get('/user/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const user = await db.oneOrNone(
      'SELECT username, bio FROM users WHERE username = $1',
      [username]
    );

    if (!user) {
      return res.status(404).render('pages/user-profile', { message: 'User not found' });
    }

    const posts = await db.any(
      'SELECT * FROM posts WHERE username = $1 ORDER BY id DESC',
      [username]
    );

    const profileUser = {
      ...user,
      pfp: `/pfp/${username}`
    };

    res.render('pages/user-profile', {
      profileUser,
      posts,
      user: req.session.user // needed to check login/ownership in template
    });

  } catch (err) {
    console.error('User profile error:', err);
    res.status(500).render('pages/user-profile', {
      message: 'Error loading profile.'
    });
  }
});



// =================== POST ROUTES ===================

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (user) {
      return res
        .status(409)
        .render('pages/register', { message: 'Username Already Taken' });
    }
    const hash = await bcrypt.hash(password, 10);
    const defaultImagePath = path.join(
      __dirname,
      'src',
      'resources',
      'img',
      'Defaultpfp.png'
    );
    const defaultImage = fs.readFileSync(defaultImagePath);

    await db.none('INSERT INTO users (username, password, pfp) VALUES ($1, $2, $3)', [
      username,
      hash,
      defaultImage,
    ]);

    return res.status(200).redirect('/login');
  } catch (err) {
    console.error('Registration Error:', err);
    return res
      .status(409)
      .render('pages/register', { message: 'Registration failed. Try again.' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return res
        .status(401)
        .render('pages/login', { message: 'Incorrect Username or Password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res
        .status(401)
        .render('pages/login', { message: 'Incorrect Username or Password.' });
    }

    user.pfp = `/pfp/${user.username}`;
    req.session.user = user;
    req.session.spotify_connected = !!req.session.spotifyAccessToken;
    req.session.apple_connected = !!req.session.appleUserToken;

    req.session.save(() => res.status(200).redirect('/home'));
  } catch (err) {
    console.error('Login Error:', err);
    res
      .status(500)
      .render('pages/login', { message: 'Server Error. Try again later.' });
  }
});

app.post('/loginTest', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return res
        .status(401)
        .json({ message: 'Incorrect Username or Password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res
        .status(401)
        .json({ message: 'Incorrect Username or Password.' });
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

    req.session.user = user;
    req.session.spotify_connected = !!req.session.spotifyAccessToken;
    req.session.apple_connected = !!req.session.appleUserToken;
    // req.session.user = {
     // updatedUser,
     // spotify_connected: !!req.session.spotifyAccessToken,
    //  apple_connected: !!req.session.appleUserToken
    // };

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

app.post('/posts', async (req, res) => {
  const { title, caption, applelink, spotLink } = req.body;

  if (!applelink && !spotLink) {
    return res
      .status(400)
      .json({ success: false, message: 'Please provide at least one link.' });
  }

  try {
    console.log(req.session.user);
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
    res
      .status(500)
      .json({ success: false, message: 'Database error while creating post.' });
  }
});

// *****************************************************
// <!-- Section 6 : Convert Playlist Logic -->
// *****************************************************

app.post('/convert-playlist', async (req, res) => {
  try {
    // 1. Check if user is logged in:
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    }

    // 2. Pull relevant data
    const { link } = req.body;
    if (!link) {
      return res.status(400).json({ error: 'No playlist link provided.' });
    }

    // Tokens
    const spotifyAccessToken = req.session.spotifyAccessToken;
    const appleMusicDeveloperToken = process.env.APPLE_MUSIC_DEV_TOKEN;
    const appleMusicUserToken = req.session.appleUserToken;
    const storefront = 'us'; // or detect region dynamically

    // Determine if link is Spotify or Apple Music
    const isSpotifyLink = link.includes('spotify.com');
    const isAppleLink = link.includes('music.apple.com');

    if (!isSpotifyLink && !isAppleLink) {
      return res.status(400).json({
        error: 'Unsupported link. Must be a Spotify or Apple Music playlist URL.',
      });
    }

    let newPlaylistId;

    // =============== SPOTIFY → APPLE MUSIC ===============
    if (isSpotifyLink) {
      // We only need Apple user token to create a playlist in their Apple library
      // We do NOT need a Spotify user token, because we read the public playlist with client credentials
      if (!appleMusicDeveloperToken || !appleMusicUserToken) {
        return res
          .status(400)
          .json({ error: 'Missing Apple Music developer token or user token.' });
      }

      // Extract the Spotify playlist ID
      const spotifyPlaylistId = extractSpotifyPlaylistId(link);
      if (!spotifyPlaylistId) {
        return res
          .status(400)
          .json({ error: 'Could not parse Spotify playlist ID from link.' });
      }

      // 1) Fetch tracks from Spotify (public) using client credentials
      // get the token once
    const spotifyClientCredentialsToken = await getSpotifyClientCredentialsToken();

    // then reuse it for both calls if you want
  const spotifyTracks = await fetchSpotifyPlaylistTracks(spotifyPlaylistId);
  const spotifyMeta = await fetch(
   `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}`,
    {
    headers: {
      Authorization: `Bearer ${spotifyClientCredentialsToken}`
    }
  }
).then(r => r.json());


      // 2) Create Apple Music playlist in user’s library
      newPlaylistId = await createAppleMusicPlaylist(
        appleMusicDeveloperToken,
        appleMusicUserToken,
        spotifyMeta.name
      );

      // 3) Search & add each track to Apple Music
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
  // → APPLE MUSIC → SPOTIFY via ISRCs
  if (!process.env.APPLE_MUSIC_DEV_TOKEN || !req.session.spotifyAccessToken) {
    return res.status(400).json({
      error:
        "Need both APPLE_MUSIC_DEV_TOKEN and a Spotify user token in session.",
    });
  }

  const applePlaylistId = extractAppleMusicPlaylistId(link);
  if (!applePlaylistId) {
    return res
      .status(400)
      .json({ error: "Could not parse Apple Music playlist ID." });
  }

  // 1) Fetch all ISRCs from the Apple playlist
  const isrcs = await fetchCatalogPlaylistIsrcs(
    applePlaylistId,
    process.env.APPLE_MUSIC_DEV_TOKEN,
    storefront
  );

  // 2) Create a new (empty) Spotify playlist
  const newSpotifyPlaylistId = await createSpotifyPlaylist(
    spotifyAccessToken
  );

  // 3) Match ISRCs → Spotify URIs
  const uris = await matchIsrcsToSpotifyUris(
    isrcs,
    spotifyAccessToken
  );

  // 4) Add them in bulk
  await addUrisToSpotifyPlaylist(
    newSpotifyPlaylistId,
    uris,
    spotifyAccessToken
  );

  newPlaylistId = newSpotifyPlaylistId;
}
// … then finally res.json({ newPlaylistId, message: 'Done!' }) …


    // Send response
    res.status(200).json({
      message: 'Playlist conversion completed!',
      newPlaylistId,
    });
  } catch (error) {
    console.error('Error in /convert-playlist:', error);
    res.status(500).json({ error: error.message });
  }
});

// *****************************************************
// <!-- Section 7 : HELPER FUNCTIONS -->
// *****************************************************

// ========== ISRC WORKAROUND HELPERS ==========

// ——— Fetch ISRCs from a public Apple Music catalog playlist ———
async function fetchCatalogPlaylistIsrcs(playlistId, devToken, storefront) {
  let isrcs = [];
  let url = `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    if (!resp.ok) {
      throw new Error(`Apple Music catalog fetch failed: ${resp.status}`);
    }
    const data = await resp.json();

    // collect ISRCs
    data.data.forEach(item => {
      const isrc = item.attributes?.isrc;
      if (isrc) isrcs.push(isrc);
    });

    // normalize next URL to absolute
    if (data.next) {
      url = new URL(data.next, 'https://api.music.apple.com').href;
    } else {
      url = null;
    }
  }

  return isrcs;
}


// ——— Match ISRCs → Spotify URIs ———
async function matchIsrcsToSpotifyUris(isrcs, accessToken) {
  const uris = [];
  for (const isrc of isrcs) {
    const resp = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=1&q=isrc:${isrc}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!resp.ok) {
      console.warn(`Spotify ISRC search failed for ${isrc}: ${resp.status}`);
      continue;
    }
    const results = await resp.json();
    const track = results.tracks.items[0];
    if (track) {
      uris.push(track.uri);
    } else {
      console.warn(`No Spotify match for ISRC ${isrc}`);
    }
  }
  return uris;
}

// ——— Add URIs to a Spotify playlist in 100‑item batches ———
async function addUrisToSpotifyPlaylist(playlistId, uris, accessToken) {
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const resp = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: batch }),
      }
    );
    if (!resp.ok) {
      console.warn(`Failed to add batch to Spotify playlist: ${resp.status}`);
    }
  }
}



// ======================================

// 1) Distinguish "catalog" vs. "library" for Apple Music
function isAppleMusicCatalogLink(link) {
  return !link.includes('/me/library') && !link.includes('pl.u-');
}

// Simple ID extractor for Spotify links
function extractSpotifyPlaylistId(spotifyLink) {
  const regex = /playlist\/([a-zA-Z0-9]+)/;
  const match = spotifyLink.match(regex);
  return match ? match[1] : null;
}

// Simple ID extractor for Apple Music links
function extractAppleMusicPlaylistId(appleLink) {
  const regex = /playlist\/.*\/(pl\.[^/?]+)/;
  const match = appleLink.match(regex);

  if (match) {
    console.log('Extracted Apple playlist ID:', match[1]);
    return match[1];
  } else {
    console.log('No Apple playlist ID found in:', appleLink);
    return null;
  }
}


// ========== Spotify Client Credentials ==========

async function getSpotifyClientCredentialsToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });
  const data = await resp.json();
  return data.access_token; // 1-hour token
}

// ========== Spotify Helpers ========== 

// Fetch tracks from a public Spotify playlist using client credentials
async function fetchSpotifyPlaylistTracks(playlistId) {
  const token = await getSpotifyClientCredentialsToken();
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;

  console.log('Fetching public Spotify playlist URL:', url);
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to fetch Spotify playlist ${playlistId}: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  return (data.items || [])
    .filter((item) => item.track)
    .map((item) => ({
      title: item.track.name,
      artist: item.track.artists?.[0]?.name || '',
      album: item.track.album?.name || '',
    }));
}

// Create a new Spotify playlist in the authorized user's account
async function createSpotifyPlaylist(accessToken) {
  const url = 'https://api.spotify.com/v1/me/playlists';
  const body = {
    name: 'Converted from Apple Music',
    public: false,
    description: 'Your Crosstuned Playlist',
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
    const errorText = await resp.text();
    throw new Error(
      `Failed to create a Spotify playlist - status: ${resp.status} body: ${errorText}`
    );
  }
  const data = await resp.json();
  return data.id;
}

async function searchSpotifyTrackUri(track, accessToken) {
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
  return firstTrack ? firstTrack.uri : null;
}

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

// ========== Apple Music Helpers ==========

// 1) Create a new Apple Music playlist
async function createAppleMusicPlaylist(devToken, userToken, name) {
  const url = 'https://api.music.apple.com/v1/me/library/playlists';
  const body = { attributes: { name, description: 'Converted from Spotify' } };

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
    const errText = await resp.text();
    console.error('Apple Music create playlist failed:', resp.status, errText);
    throw new Error(`Apple create failed: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data.data?.[0]?.id;
}


// 2) Fetch tracks from a user’s library playlist
async function fetchAppleMusicPlaylistTracks(playlistId, devToken, userToken, storefront) {
  // GET /v1/me/library/playlists/{id}/tracks
  const url = `https://api.music.apple.com/v1/me/library/playlists/${playlistId}/tracks`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${devToken}`,
      'Music-User-Token': userToken,
    },
  });
  if (!resp.ok) {
    const errorMsg = await resp.text();
    throw new Error(
      `Failed to fetch Apple Music library playlist ${playlistId} - ${resp.status} - ${errorMsg}`
    );
  }

  const data = await resp.json();
  return (data.data || []).map((item) => ({
    title: item.attributes?.name || '',
    artist: item.attributes?.artistName || '',
    album: item.attributes?.albumName || '',
  }));
}

// 3) For a public “catalog” Apple Music playlist
async function fetchPublicAppleMusicPlaylistTracks(playlistId, devToken, storefront) {
  // GET /v1/catalog/{storefront}/playlists/{id}?include=tracks
  const url = `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${playlistId}?include=tracks`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${devToken}`,
    },
  });
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch public Apple Music catalog playlist ${playlistId}. Status: ${resp.status}`
    );
  }
  const data = await resp.json();

  const tracksData = data.data?.[0]?.relationships?.tracks?.data || [];
  return tracksData.map((item) => ({
    title: item.attributes?.name || '',
    artist: item.attributes?.artistName || '',
    album: item.attributes?.albumName || '',
  }));
}

// 4) Search Apple Music for a track
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

// 5) Add a song to Apple Music playlist
async function addSongToAppleMusicPlaylist(playlistId, songId, devToken, userToken) {
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
// <!-- Section 8 : Start Server -->
// *****************************************************

module.exports = app.listen(3000, () => console.log('Server is listening on port 3000'));
