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
  const openRoutes = ['/login', '/register', '/home'];
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

// SPOTIFY CALLBACK FUNCTION - Renner
app.get('/callback', async (req, res) => {
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
        redirect_uri: 'http://localhost:3000/callback'
      })
    });

    const tokenData = await tokenResponse.json();
    // Debugging
    console.log('Token Data:', tokenData);

    const accessToken = tokenData.access_token;

    // Make request to get user info
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const userInfo = await userResponse.json();

    // save access token and URL
    console.log('Spotify User Info:', userInfo); // <- ✅ Your console.log
    req.session.spotifyAccessToken = accessToken;
    res.redirect('/home'); // or wherever you want to redirect

  } catch (error) {
    console.error('Error during Spotify callback:', error);
    res.status(500).send('Spotify authentication failed');
  }
});

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('pages/login', { pageTitle: 'Login' }));

app.get('/register', (req, res) => res.render('pages/register'));

app.get('/home', (req, res) => res.render('pages/home'));

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

// Spotify Playlist post
app.post('/search-playlist', async (req, res) => {
  const { playlistTitle } = req.body;
  const token = req.session.spotifyAccessToken;

  if (!token) {
    return res.render('pages/home', { message: 'You must connect to Spotify first.' });
  }

  try {
    // Fetch user's playlists
    const playlistResponse = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await playlistResponse.json();

    console.log('Fetched Playlists:', data.items.map(p => p.name));

    // Search for matching title
    const match = data.items.find(p =>
      p.name.toLowerCase().includes(playlistTitle.toLowerCase())
    );

    if (!match) {
      return res.render('pages/home', { message: 'Playlist not found.' });
    }

    console.log('Matched Playlist:', match); // ✅ Playlist info
    return res.render('pages/home', {
      message: `Playlist "${match.name}" found!`,
      playlist: match
    });

  } catch (err) {
    console.error('Error fetching playlists:', err);
    return res.render('pages/home', { message: 'Something went wrong. Try again.' });
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

// *****************************************************
// <!-- Section 7 : Start Server -->
// *****************************************************

app.listen(3000, () => console.log('Server is listening on port 3000'));
