import logo from './logo.svg';
import './App.css';
import SignIn from './account/signIn';
import Account from './account/account';
import { hideLoader } from './loader/loader';
import { useState, useEffect } from 'react';

export default function App() {
  useEffect(hideLoader);
  let [isSignedIn, setIsSignedIn] = useState(false);
  let [username, setUsername] = useState("");
  let [password, setPassword] = useState("");

  const backend = "https://passwords.maplexu.me";

  const setAccountInfo = (user, pw) => {
    setUsername(user);
    setPassword(pw);
    setIsSignedIn(true);
  }

  const resetAccountInfo = () => {
    setPassword("");
    setIsSignedIn(false);
  }

  return (
    <div className="App">
      {isSignedIn ?
        <Account
          username={username}
          password={password}
          backend={backend}
          reset={resetAccountInfo}
        /> :
        <div className="App-header">
          <p>"Welcome to ObscurePasswordManager!"</p>
          <div className="App-subheader">
            <SignIn 
              user={username}
              backend={backend}
              setAccountInfo={setAccountInfo}
            />
          </div>
        </div>
      }
    </div>
  );
};