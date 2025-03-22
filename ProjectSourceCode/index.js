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
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/css', express.static(path.join(__dirname, 'src/resources/css')));

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
// <!-- Section 4 : API Routes -->
// *****************************************************

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

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (user) {
      return res.render('pages/register', { message: 'Username Already Taken' });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.none('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hash]);
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
    req.session.user = user;
    req.session.save(() => res.redirect('/home'));
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).render('pages/login', { message: 'Server Error. Try again later.' });
  }
});

// *****************************************************
// <!-- Section 5 : Settings Page -->
// *****************************************************

app.get('/settings', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('pages/settings', { user: req.session.user });
});

app.post('/settings', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const { username, bio } = req.body;
  try {
    const updatedUser = await db.one(
      'UPDATE users SET username = $1, bio = $2 WHERE id = $3 RETURNING *',
      [username, bio, req.session.user.id]
    );
    req.session.user = updatedUser;
    res.redirect('/settings');
  } catch (err) {
    console.error('Settings Update Error:', err);
    res.render('pages/settings', { user: req.session.user, message: 'Error updating settings.' });
  }
});

// *****************************************************
// <!-- Section 6 : Profile Page -->
// *****************************************************

app.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('pages/profile', { user: req.session.user });
});

// *****************************************************
// <!-- Section 7 : Start Server -->
// *****************************************************

app.listen(3000, () => console.log('Server is listening on port 3000'));