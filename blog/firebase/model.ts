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


// export default admin.database();
export default new class {
  constructor(db) {
    this.db = db;
  }

  async _getChildrenFunc(path, functor, orderByChildPath) {
    let l = [];
    await this.db.ref(path).orderByChild(orderByChildPath).once('value').then(s => {
      s.forEach(c => {
        l.push(functor(c));
      });
    });

    return l;
  }

  async getChildrenKeyVals(path, orderByChildPath) {
    const functor = x => ({key:x.key, val: x.val()});
    return this._getChildrenFunc(path, functor, orderByChildPath);
  }

  async getChildrenKeys(path, orderByChildPath) {
    const functor = x => x.key;
    return this._getChildrenFunc(path, functor, orderByChildPath);
  }

  ref(prop) {
    return this.db.ref(prop);
  }

  // child(prop) {
  //   return this.db.child(prop);
  // }

} (admin.database());

console.log("***** Done loading *****")