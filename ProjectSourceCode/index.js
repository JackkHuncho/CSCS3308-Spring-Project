// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part C.

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: 'hbs',
  // kendrix - Adjusted directory so now our layouts and paritals work!
  layoutsDir: __dirname + '/src/views/layouts',
  partialsDir: __dirname + '/src/views/partials',
});

// database configuration
const dbConfig = {
  host: 'db', // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful'); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
// Kendrix - Changed the path so that we are serachingin the correct directory.
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
/*app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);*/

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// Kendrix - this is for our css,
app.use('/css', express.static(path.join(__dirname, 'src/resources/css')));

// we need to put auth middleware here

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res)=> {
  res.render('pages/login', {pageTitle: 'Login'});
});

app.get('/register', (req,res) => {
      res.render('pages/register');
});

app.get('/home', (req, res) => {
    res.render('pages/home');
})

app.post('/register', async(req, res) =>{
  let data = req.body;
  try {
    const hash = await bcrypt.hash(req.body.password, 10);
    const query = `INSERT INTO users (username, password) VALUES ('${data.username}', '${hash}') RETURNING *`;
    const results = await db.oneOrNone(query);
    return res.redirect('/login');
  } catch (err) {
    return res.redirect('/register');
  }
});

app.post('/login', async(req, res) =>{
  const data = req.body;
  const query = `SELECT * FROM users WHERE username = '${data.username}'`;
  try {
    const user = await db.oneOrNone(query);
    if(!user){
      return res.redirect('/register');
    }

      const match = await bcrypt.compare(data.password, user.password);  

      if(!match){
        return res.render('pages/login.hbs', { message: 'Incorrect Password or Username.' });
      }


      req.session.user = user;
      req.session.save(() => {
        res.redirect('/home');
      });
    

  } catch (err) {
    console.error(err);
    res.status(501).send("Server Error");
  }
});

// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
app.listen(3000);
console.log('Server is listening on port 3000');