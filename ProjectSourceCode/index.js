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


// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, 'src', 'views', 'layouts'),
  partialsDir: path.join(__dirname, 'src', 'views', 'partials'),
  helpers: {
    convertToEmbed: (url) => {
      const match = url.match(/playlist\/([^?]+)/);
      if (!match) return '';
      const id = match[1];
      return `https://open.spotify.com/embed/playlist/${id}?utm_source=generator`;
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
  res.locals.user = req.session.user;
  next();
};
app.use(auth);

// *****************************************************
// <!-- Section 5 : API Routes -->
// *****************************************************

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
      return res.status(409).json({ message: 'Username already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const defaultImagePath = path.join(__dirname, 'src', 'resources', 'img', 'Defaultpfp.png');
    const defaultImage = fs.readFileSync(defaultImagePath);

    await db.none('INSERT INTO users (username, password, pfp) VALUES ($1, $2, $3)', [username, hash, defaultImage]);

    return res.status(200).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Registration Error:', err);
    return res.status(409).json({ message: 'Username already exists' });
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

    user.pfp = `/pfp/${user.username}`;
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

    const post = await db.one(
      'INSERT INTO posts (title, caption, duration, applelink, spotLink, upvotes) VALUES ($1, $2, $3, $4, $5, 0) RETURNING *',
      [title, caption, duration, applelink || null, spotLink || null]
    );

    res.json({ success: true, post });
  } catch (err) {
    console.error('Post creation error:', err);
    res.status(500).json({ success: false, message: 'Database error while creating post.' });
  }
});

// *****************************************************
// <!-- Section 7 : Start Server -->
// *****************************************************

module.exports = app.listen(3000, () => console.log('Server is listening on port 3000'));
