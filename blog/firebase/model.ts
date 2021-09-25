import cert from './firebase_key.js';

console.log('***** Loading firebase database *****');
// import * as admin from 'firebase-admin';
var admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(cert),
    databaseURL: "https://blog-fcdf6-default-rtdb.firebaseio.com"
  });
}

export default admin.database();