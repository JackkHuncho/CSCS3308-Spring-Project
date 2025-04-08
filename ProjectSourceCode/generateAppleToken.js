const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Replace these values with your real ones:
const privateKey = fs.readFileSync(path.join(__dirname, 'AuthKey_K3WR5JPV43.p8')); // Renner's authkey file for CrossTune
const teamId = '8VPB777JN3';      // Renner's Account Keys
const keyId = 'K3WR5JPV43';        // Renner's Account Keys

const token = jwt.sign({}, privateKey, {
  algorithm: 'ES256',
  expiresIn: '180d', // Max: 6 months
  issuer: teamId,
  header: {
    alg: 'ES256',
    kid: keyId,
  }
});

console.log('\nYour Apple Developer Token:\n');
console.log(token);
