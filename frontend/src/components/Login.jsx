import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const BACKEND_URL = import.meta.env.PROD ? '' : 'http://localhost:5000';

const Login = () => {
  const [username, setUsername] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !passcode) {
      setError('Please fill all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await axios.post(`${BACKEND_URL}/api/login`, { username, passcode });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <h1 className="auth-title">ViRaj Connect</h1>
      <p style={{textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '10px'}}>Vimal & Rajini's Private Space</p>
      
      {error && <div className="error-msg">{error}</div>}
      
      <form onSubmit={handleLogin} style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
        <div className="input-group">
          <label>Who are you?</label>
          <select 
            className="auth-input" 
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          >
            <option value="" disabled>Select your name...</option>
            <option value="Vimal">Vimal</option>
            <option value="Raj">Raj</option>
          </select>
        </div>
        
        <div className="input-group">
          <label>Secret Passcode</label>
          <input 
            type="password" 
            className="auth-input" 
            placeholder="••••••••" 
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
        </div>
        
        <button type="submit" className="auth-btn" disabled={loading}>
          {loading ? 'Entering...' : 'Enter ViRaj Connect'}
        </button>
      </form>
    </div>
  );
};

export default Login;
