import { useState, useEffect } from "react";
import Modal from "react-modal";

const customStyles = {
  content: {
    top: "50%",
    left: "50%",
    right: "auto",
    bottom: "auto",
    alignItems: "left",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: "pink",
    opacity: 1,
  },
  overlay: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
};

export default function AddPasswordsModal({
  en_pw,
  en_user,
  backend,
  show,
  stopShowing,
}) {
  useEffect(() => {
    Modal.setAppElement("#account-root");
  });

  return (
    <div key="AddPasswords">
      <Modal
        isOpen={show}
        onRequestClose={stopShowing}
        style={customStyles}
        contentLabel="Settings"
        closeTimeoutMS={200}
      >
        <div>todo</div>
      </Modal>
    </div>
  );
}
