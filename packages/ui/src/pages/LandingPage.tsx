import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const [modalOpen, setModalOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const firstNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/overview', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    if (modalOpen) firstNameRef.current?.focus();
  }, [modalOpen]);

  function isValidEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  const canSubmit = firstName.trim() && lastName.trim() && isValidEmail(email.trim());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setModalOpen(false);
    setSubmitted(true);
    setFirstName('');
    setLastName('');
    setEmail('');
    setEmailInvalid(false);
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Funnel+Sans:wght@300;400;500;600;700&display=swap');

        .landing-page *, .landing-page *::before, .landing-page *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .landing-page {
          font-family: 'Funnel Sans', sans-serif;
          -webkit-font-smoothing: antialiased;
          position: relative;
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .landing-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
        }

        .landing-bg img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .landing-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-top: -5vh;
        }

        .landing-top-banner {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px 24px;
          opacity: 0;
          animation: landing-fade-down 1s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
        }

        .landing-top-banner span {
          font-size: clamp(14px, 2vw, 20px);
          font-weight: 400;
          letter-spacing: 0.08em;
          color: #ffffff;
          text-shadow: 0 1px 12px rgba(0, 0, 0, 0.08);
        }

        .landing-title {
          font-weight: 400;
          font-size: clamp(72px, 14vw, 180px);
          letter-spacing: -0.02em;
          line-height: 0.95;
          color: #ffffff;
          margin-top: 4px;
          text-shadow: 0 2px 40px rgba(0, 0, 0, 0.12);
          opacity: 0;
          animation: landing-rise 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.25s forwards;
        }

        .landing-tagline {
          font-size: clamp(16px, 2.5vw, 24px);
          font-weight: 300;
          letter-spacing: 0.03em;
          color: #ffffff;
          margin-top: 8px;
          opacity: 0;
          animation: landing-rise 1s cubic-bezier(0.16, 1, 0.3, 1) 0.38s forwards;
        }

        .landing-cta {
          margin-top: 28px;
          opacity: 0;
          animation: landing-rise 1s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards;
        }

        .landing-cta-btn {
          display: inline-flex;
          align-items: center;
          background: #ffffff;
          color: #4e6a3a;
          font-family: 'Funnel Sans', sans-serif;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.04em;
          padding: 14px 32px;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .landing-cta-btn:hover {
          transform: translateY(-2px) scale(1.03);
          box-shadow: 0 8px 24px rgba(255, 255, 255, 0.3);
        }

        .landing-cta-btn:active { transform: translateY(0) scale(1.01); }

        .landing-cta-btn.done {
          background: #4e6a3a;
          color: #faf5ed;
          pointer-events: none;
        }

        /* Modal */
        .landing-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(78, 66, 52, 0.35);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.35s ease;
        }

        .landing-modal-overlay.open {
          opacity: 1;
          pointer-events: auto;
        }

        .landing-modal {
          background: #faf5ed;
          border-radius: 24px;
          padding: 44px 40px 40px;
          width: 90%;
          max-width: 440px;
          box-shadow: 0 24px 64px rgba(78, 66, 52, 0.2), 0 0 0 1px rgba(196, 168, 120, 0.15);
          transform: translateY(20px) scale(0.97);
          transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .landing-modal-overlay.open .landing-modal {
          transform: translateY(0) scale(1);
        }

        .landing-modal-title {
          font-size: 22px;
          font-weight: 600;
          color: #3d3529;
          margin-bottom: 6px;
        }

        .landing-modal-sub {
          font-size: 14px;
          color: #a08b78;
          margin-bottom: 28px;
        }

        .landing-modal-row {
          display: flex;
          gap: 12px;
        }

        .landing-modal-field {
          display: flex;
          flex-direction: column;
          flex: 1;
          margin-bottom: 16px;
        }

        .landing-modal-field label {
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.03em;
          color: #5c5040;
          margin-bottom: 6px;
        }

        .landing-modal-field input {
          font-family: 'Funnel Sans', sans-serif;
          font-size: 14px;
          padding: 12px 14px;
          border: 1.5px solid #ddd4c6;
          border-radius: 10px;
          outline: none;
          background: #fff9f2;
          color: #3d3529;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .landing-modal-field input::placeholder { color: #c4b8a6; }

        .landing-modal-field input:focus {
          border-color: #4e6a3a;
          box-shadow: 0 0 0 3px rgba(78, 106, 58, 0.1);
        }

        .landing-modal-field input.invalid {
          border-color: #c47a5a;
          box-shadow: 0 0 0 3px rgba(196, 122, 90, 0.1);
        }

        .landing-modal-actions {
          display: flex;
          gap: 12px;
          margin-top: 8px;
        }

        .landing-btn-cancel {
          flex: 1;
          font-family: 'Funnel Sans', sans-serif;
          font-size: 14px;
          font-weight: 500;
          padding: 13px 0;
          border-radius: 9999px;
          border: 1.5px solid #ddd4c6;
          background: transparent;
          color: #5c5040;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }

        .landing-btn-cancel:hover {
          background: #f0e8db;
          border-color: #c4b8a6;
        }

        .landing-btn-submit {
          flex: 1;
          font-family: 'Funnel Sans', sans-serif;
          font-size: 14px;
          font-weight: 500;
          padding: 13px 0;
          border-radius: 9999px;
          border: none;
          background: #4e6a3a;
          color: #faf5ed;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
        }

        .landing-btn-submit:enabled:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(78, 106, 58, 0.3);
        }

        .landing-btn-submit:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        @keyframes landing-rise {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes landing-fade-down {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 480px) {
          .landing-content { margin-top: -8vh; }
          .landing-cta-btn { font-size: 13px; padding: 12px 26px; }
          .landing-modal { padding: 28px 24px 24px; }
          .landing-modal-row { flex-direction: column; gap: 0; }
        }
      `}</style>

      <section className="landing-page">
        <div className="landing-bg">
          <img src="/images/batta3.jpeg" alt="Serene landscape with mountains, river, and ducks" />
        </div>

        <div className="landing-top-banner">
          <span>Coming soon...</span>
        </div>

        <div className="landing-content">
          <h1 className="landing-title">Batta</h1>
          <p className="landing-tagline">The trust to run faster.</p>
          <div className="landing-cta">
            <button
              className={`landing-cta-btn${submitted ? ' done' : ''}`}
              onClick={() => !submitted && setModalOpen(true)}
            >
              {submitted ? "You're on the list ✓" : 'Join the waitlist'}
            </button>
          </div>
        </div>
      </section>

      <div
        className={`landing-modal-overlay${modalOpen ? ' open' : ''}`}
        onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}
      >
        <div className="landing-modal">
          <div className="landing-modal-title">Join the waitlist</div>
          <p className="landing-modal-sub">Be the first to know when Batta launches.</p>
          <form onSubmit={handleSubmit} noValidate>
            <div className="landing-modal-row">
              <div className="landing-modal-field">
                <label htmlFor="lp-firstName">First name</label>
                <input
                  ref={firstNameRef}
                  id="lp-firstName"
                  type="text"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="landing-modal-field">
                <label htmlFor="lp-lastName">Last name</label>
                <input
                  id="lp-lastName"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="landing-modal-field">
              <label htmlFor="lp-email">Email</label>
              <input
                id="lp-email"
                type="email"
                placeholder="jane@example.com"
                value={email}
                className={emailInvalid ? 'invalid' : ''}
                onChange={(e) => { setEmail(e.target.value); setEmailInvalid(false); }}
                onBlur={() => setEmailInvalid(email.trim() !== '' && !isValidEmail(email.trim()))}
                required
              />
            </div>
            <div className="landing-modal-actions">
              <button type="button" className="landing-btn-cancel" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="landing-btn-submit" disabled={!canSubmit}>
                Submit
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
