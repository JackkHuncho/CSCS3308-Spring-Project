// ********************** Initialize server **********************************

const server = require('../index'); //TODO: Make sure the path to your index.js is correctly added

// ********************** Import Libraries ***********************************

const chai = require('chai'); // Chai HTTP provides an interface for live integration testing of the API's.
const chaiHttp = require('chai-http');
chai.should();
chai.use(chaiHttp);
const {assert, expect} = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************

describe('Server!', () => {
  // Sample test case given to test / endpoint.
  it('Returns the default welcome message', done => {
    chai
      .request(server)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equals('success');
        assert.strictEqual(res.body.message, 'Welcome!');
        done();
      });
  });
});

// *********************** TESTING REGISTER API WITH SETUP AND TEARDOWN **************************

describe('Testing Register API', () => {

  // Positive test case: Register a new user
  it('positive : /register - should register a new user', (done) => {
    chai
      .request(server)
      .post('/register')
      .send({
        username: '431',
        password: 'Test@1234'
      })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.message).to.equals('User registered successfully');
        done();
      });
  });

  // Negative test case: Try to register with the same username
  it('negative : /register - should reject duplicate username', (done) => {
    const duplicateUser = {
      username: 'cam', // Same username as positive test
      password: 'testinggg' // Diff password
    };

    chai
      .request(server)
      .post('/register')
      .send(duplicateUser)
      .end((err, res) => {
        // Verify the response
        expect(res).to.have.status(409); // 409 Conflict is standard for duplicates
        expect(res.body.message).to.match(/username already exists|already taken/i);
        done();
      });
  });

});
