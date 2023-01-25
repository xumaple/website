import logo from './logo.svg';
import './App.css';
import SignIn from './account/signIn';
import PasswordQuery from './account/passwordQuery';
import { hideLoader } from './loader/loader';
import { useState, useEffect } from 'react';

export default function App() {
  useEffect(hideLoader);
  let [isSignedIn, setIsSignedIn] = useState(false);
  let [username, setUsername] = useState("");
  let [password, setPassword] = useState("");

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
      <div className="App-header">
        <p>{isSignedIn ? `Hello, ${username}` : "Welcome to ObscurePasswordManager!"}</p>
        <div className="App-subheader">
          {isSignedIn ?
            <PasswordQuery
              username={username}
              password={password}
              reset={resetAccountInfo}
            /> :
            <SignIn 
              user={username}
              setAccountInfo={setAccountInfo}
            />}
        </div>
      </div>
    </div>
  );
};