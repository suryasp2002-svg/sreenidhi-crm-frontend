import React, { useEffect, useState } from 'react';

function App() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('http://localhost:5000/')
      .then(res => res.text())
      .then(setMessage);
  }, []);

  return (
    <div>
      <h1>Backend says:</h1>
      <p>{message}</p>
    </div>
  );
}

export default App;