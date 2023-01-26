import { useState, useEffect } from 'react';
import Modal from 'react-modal';
import { showLoader, hideLoader } from '../../loader/loader';
import { changePassword, checkPassword } from '../../crypto/encrypt';
import './settings.css';


const customStyles = {
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    alignItems: 'left',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'pink',
    opacity: 1
  },
  overlay: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)'
  }
};

export default function SettingsModal({ username, password, backend, setPassword, show, stopShowing }) {
  const [pw, setPw] = useState(password);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  useEffect(() => {
    Modal.setAppElement('#account-root');
  });

  const trySave = async () => {
    if (newPw !== newPw2) {
      setErrorMsg("Passwords must match");
      return;
    }
    if (!checkPassword(newPw, errorMsg, setErrorMsg)) {
      return;
    }
    const newPwTry = newPw;
    setNewPw("");
    setNewPw2("");
    setErrorMsg("");
    setIsSaving(true);
    setMsg("Updating password...");
    showLoader();
    if (await changePassword(backend, username, pw, newPwTry)) {
      // success
      // setPw(newPwTry);
      setMsg(<div className="green">"Password updated successfully."</div>)
    }
    else {
      setMsg("");
      setErrorMsg("Unable to update password.")
    }
    hideLoader();
  }

  const closeModal = () => {
    isSaving && setTimeout(() => {
      setNewPw("");
      setNewPw2("");
      setMsg("");
      setErrorMsg("");
    }, 200);
    stopShowing();
  }
  
  return (<div>
    <Modal
      isOpen={show}
      onRequestClose={closeModal}
      style={customStyles}
      contentLabel="Settings"
      closeTimeoutMS={200}
    >
      <div className="Settings-modal">
        <h1>Edit Settings</h1>
        <div className="row">
          <div>Username:</div>
          <div><input className="disabled"
            type="text"
            // onChange={(e)=>{setUsername(e.target.value);}}
            value={username}
            disabled="disabled"
            
            // onKeyPress={onKeyPress}
          /></div>
        </div>
        <div className="row">
          <div className="info">New Password:</div>
          <div><input
            type="password"
            placeholder="new password"
            onChange={(e)=>{setNewPw(e.target.value);}}
            value={newPw}
          
            // onKeyPress={onKeyPress}
          /></div>
        </div>
        <div className="row">
          <div className="info">Confirm Password:</div>
          <div><input
            type="password"
            placeholder="confirm password"
            onChange={(e)=>{setNewPw2(e.target.value);}}
            value={newPw2}
          
            // onKeyPress={onKeyPress}
          /></div>
        </div>
        <div className="msg">
          <div>{msg}</div>
          <div className="error">{errorMsg}</div>
        </div>
        <div className="buttons">
          <button onClick={trySave}>Save</button>
          <button onClick={closeModal}>Done</button>
        </div>
      </div>
    </Modal>
  </div>);
}