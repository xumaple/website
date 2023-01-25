import { useState } from 'react';
import './account.css';
import { encryptMaster } from '../crypto/encrypt';
import { showLoader, hideLoader } from '../loader/loader';

const KeyBinds = {
  ENTER: 13
}

const ERROR_MSG_TIME_IN_MS = 10000;
const TOGGLE_CREATE_ACCOUNT_DELAY_IN_MS = 300;
const PW_MIN_LEN = 12;

export default function SignIn({ user, setAccountInfo }) {
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [errorMsg, setErrorMsgHook] = useState("");
  const setErrorMsg = (msg) => {
    setTimeout(() => {setErrorMsgHook("")}, ERROR_MSG_TIME_IN_MS);
    setErrorMsgHook(msg);
  }
  const [username, setUsername] = useState(user);
  const [password, setPasswordHook] = useState("");

  let submit = () => {
    if (username === "" || password === "") {
      setErrorMsg("Please enter a valid username and password.");
      return;
    }
    const submittedPw = encryptMaster(password);
    setPasswordHook("");
    console.log("submitted!", username, submittedPw);
    showLoader();
    fetch(
      isCreatingAccount ? 
      `http://localhost:8000/api/v1/post/newuser/${username}/${submittedPw}` : 
      `http://localhost:8000/api/v1/get/verifyuser/${username}/${submittedPw}`, 
      { 
        method: isCreatingAccount ? 'POST' : 'GET',
        headers: { 'Content-Type': 'text/plain' }
      }
    )
      .then((response) => {
        if (response.status !== 200 ){
          console.log(response);
          throw new Error("Unable to log in.");
        }
        setAccountInfo(username, submittedPw);
      })
      .catch((e) => {
        setErrorMsg("Unable to log in, please try again.");
        console.error(e);
      })
      .finally(hideLoader);
  }

  const toggleCreatingAccount = (b) => {
    showLoader();
    setTimeout(() => {
      hideLoader();
      setIsCreatingAccount(b);
    }, TOGGLE_CREATE_ACCOUNT_DELAY_IN_MS);
    setErrorMsgHook("");
  }

  const onKeyPress = (e, verifyPassword=false) => {
    if (e.charCode === KeyBinds.ENTER) {
      if (verifyPassword && !checkPassword(password)) {
        return;
      }
      submit();
    }
  }

  const setPassword = (password) => {
    if (isCreatingAccount) {
      checkPassword(password);
    }
    setPasswordHook(password);
  }

  const checkPassword = (pw) => {
    let ret = pw.length >= PW_MIN_LEN;
    console.log("password:", pw, ret);
    if (!ret) {
      setErrorMsgHook(`Password must be at least ${PW_MIN_LEN} characters.`);
    }
    else if (errorMsg.startsWith("Password must be at least")) {
      setErrorMsgHook("");
    }
  }

  return (<div className="SignIn">
    <div className="SignIn-info">
      {isCreatingAccount ? 
        <div>Please set up a new account:</div> :
        <div>To begin, please sign in to your account:</div>
      }
      <div className={errorMsg.length == 0 ? 
        "SignIn-error-invis" : 
        "SignIn-error"
      }>{errorMsg.length == 0 ? "NoError" : errorMsg}</div>
      <input
        type="text"
        placeholder="username"
        onChange={(e)=>{setUsername(e.target.value);}}
        value={username}
        onKeyPress={onKeyPress}
      />
      <input 
        type="password"
        placeholder="password"
        onChange={(e)=>{setPassword(e.target.value);}}
        value={password}
        onKeyPress={isCreatingAccount ? (e)=>{onKeyPress(e, true);} : onKeyPress}
      />
    </div>
    <button type="button" onClick={submit}>{isCreatingAccount?"Sign up":"Log In"}</button>    
    {isCreatingAccount ? 
      <p>
        Have an account already? Log in <span
          className="SignIn-link"
          onClick={() => {toggleCreatingAccount(false);}}
        >
          here
        </span>.
      </p> : 
      <p>
        First time? Sign up <span
          className="SignIn-link"
          onClick={() => {toggleCreatingAccount(true);}}
        >
          here
        </span>.
      </p>}
  </div>);
}