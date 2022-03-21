import { NONAME } from "dns";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, query, orderByChild, orderByKey, onValue, get, child } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCyIrvzuV9BFTarckt7cctysQlNfEd-Sm8",
  authDomain: "blog-fcdf6.firebaseapp.com",
  databaseURL: "https://blog-fcdf6-default-rtdb.firebaseio.com",
  projectId: "blog-fcdf6",
  storageBucket: "blog-fcdf6.appspot.com",
  messagingSenderId: "952229116288",
  appId: "1:952229116288:web:70d090ebc2b99223a8e965",
  measurementId: "G-6KD3JPZY4C"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export default new class {
  constructor(db) {
    this.db = db;
  }

  _getChildrenFunc(path, functor, orderBy) {
    let l = [];
    onValue(query(ref(this.db, path), orderBy), s => {
      s.forEach(c => {
        l.push(functor(c));
      })
    });
    return l;
  }

  getChildrenVals(path, orderPath) {
    const functor = x => x.val();
    return this._getChildrenFunc(path, functor, orderByChild(orderPath));
  }

  getChildrenKeyVals(path, orderPath) {
    const functor = x => {return {key:x.key, val:x.val()};};
    return this._getChildrenFunc(path, functor, orderByChild(orderPath));
  }

  getChildrenKeys(path) {
    const functor = x => x.key;
    return this._getChildrenFunc(path, functor, orderByKey());
  }

  getVal(path) {
    // return get(ref(this.db, path)).then(s => s.val());
    return onValue(ref(this.db, path), s => s.val(), { onlyOnce: true});
  }
  
} (getDatabase(app));

// export default getDatabase(app);